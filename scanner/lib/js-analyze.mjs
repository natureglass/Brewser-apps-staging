// JS AST analyzer — surface rules (§1.3) + light intra-function taint (§1.4).
//
// Parses with @babel/parser (errorRecovery so odd/obfuscated input still yields
// a partial tree) and walks with @babel/traverse. Taint keys off Babel scope
// bindings so shadowed names don't cross-contaminate. The single most valuable
// rule is the token-read -> network-egress dataflow (auth-exfil-dataflow); the
// taint engine invests there.
//
// If parsing fails entirely we fall back to a regex backstop so parser-breaking
// obfuscation can't hide the crown-jewel patterns.
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { makeFinding } from './finding.mjs';
import { INFO, SUSPICIOUS, DANGEROUS } from './severity.mjs';
import { shannonEntropy, base64ishRatio } from './entropy.mjs';
import {
  EXEC_SINKS, SENSITIVE_GLOBALS, DECODE_FNS,
  PERIPHERAL_APIS, NFC_CTOR, isPeripheralNavProp, MINER_SIGNATURES,
} from './signatures.mjs';
import { isExternalUrl } from './origins.mjs';

const traverse = _traverse.default || _traverse;

const ENTROPY_MIN_LEN = 200;
const ENTROPY_THRESHOLD = 4.3;

function lineOf(node) {
  return node && node.loc && node.loc.start ? node.loc.start.line : 0;
}

function snippet(code, node) {
  if (!node || !node.start || !node.end) return '';
  return code.slice(node.start, Math.min(node.end, node.start + 200));
}

// ---------------------------------------------------------------------------
// Static string resolution: literal, concatenation of statics, or a template
// with only static quasis. Returns { value, static:true } or { static:false }.
// ---------------------------------------------------------------------------
function staticString(node) {
  if (!node) return { static: false };
  if (node.type === 'StringLiteral') return { value: node.value, static: true };
  if (node.type === 'NumericLiteral') return { value: String(node.value), static: true };
  if (node.type === 'TemplateLiteral') {
    if (node.expressions.length === 0) {
      return { value: node.quasis.map((q) => q.value.cooked).join(''), static: true };
    }
    // Partially static: resolve what we can, mark non-static.
    return { static: false, fragments: node.quasis.map((q) => q.value.cooked) };
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const l = staticString(node.left);
    const r = staticString(node.right);
    if (l.static && r.static) return { value: l.value + r.value, static: true };
    const frags = [];
    if (l.static) frags.push(l.value); else if (l.fragments) frags.push(...l.fragments);
    if (r.static) frags.push(r.value); else if (r.fragments) frags.push(...r.fragments);
    return { static: false, fragments: frags };
  }
  return { static: false };
}

// Any statically-known literal fragment that is an external URL (for assembled
// egress detection).
function externalFragment(node, allowlist) {
  const s = staticString(node);
  if (s.static) return isExternalUrl(s.value, allowlist) ? s.value : null;
  for (const f of s.fragments || []) {
    if (typeof f === 'string' && isExternalUrl(f, allowlist)) return f;
  }
  return null;
}

// Dotted member name, resolving static computed keys. `window['fe'+'tch']`
// resolves to "window.fetch". Returns null if any segment is non-static.
function memberPath(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression') {
    const objName = memberPath(node.object);
    if (objName == null) return null;
    let prop;
    if (!node.computed && node.property.type === 'Identifier') {
      prop = node.property.name;
    } else {
      const s = staticString(node.property);
      if (!s.static) return null;
      prop = s.value;
    }
    return objName + '.' + prop;
  }
  return null;
}

export function analyzeJs(code, file, ctx) {
  const findings = [];
  const peripheralsUsed = new Set();
  const add = (f) => findings.push(makeFinding(f));

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport', 'topLevelAwait'],
    });
  } catch (e) {
    add({ rule_id: 'file-parse-error', severity: INFO, file, line: 0,
      detail: 'Could not parse as JS (' + e.name + '); ran regex backstop only.', evidence: e.message });
    regexBackstop(code, file, ctx, add);
    return { findings, peripheralsUsed };
  }

  // Known crypto-miner signatures — a cheap substring sweep over the source
  // (catches both library references and inlined miner code). One hit per file.
  {
    const lower = code.toLowerCase();
    for (const sig of MINER_SIGNATURES) {
      if (lower.includes(sig)) {
        add({ rule_id: 'miner-signature', severity: DANGEROUS, file, line: 0,
          detail: 'Contains a known crypto-miner signature ("' + sig + '") — unauthorized resource abuse.',
          evidence: sig });
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Taint: collect assignments, fixpoint over binding taint, then sink pass.
  // Labels: 'auth' (brewser_auth), 'storage', 'cookie', 'device', 'decode',
  //         'network' (fetched response body — reassembled-payload).
  // -------------------------------------------------------------------------
  const taint = new Map(); // binding node -> Set<label>

  function bindingNodeFor(scope, name) {
    const b = scope && scope.getBinding(name);
    return b ? b.path.node : null;
  }

  // Compute the taint label set of an expression in a given scope.
  function exprLabels(node, scope, depth = 0) {
    if (!node || depth > 40) return new Set();
    const out = new Set();
    const merge = (s) => { for (const x of s) out.add(x); };

    switch (node.type) {
      case 'Identifier': {
        const bn = bindingNodeFor(scope, node.name);
        if (bn && taint.has(bn)) merge(taint.get(bn));
        return out;
      }
      case 'CallExpression': {
        merge(sourceLabelsForCall(node));
        for (const a of node.arguments) merge(exprLabels(a, scope, depth + 1));
        return out;
      }
      case 'NewExpression': {
        for (const a of node.arguments) merge(exprLabels(a, scope, depth + 1));
        return out;
      }
      case 'MemberExpression': {
        merge(sourceLabelsForMember(node));
        merge(exprLabels(node.object, scope, depth + 1));
        return out;
      }
      case 'BinaryExpression':
        merge(exprLabels(node.left, scope, depth + 1));
        merge(exprLabels(node.right, scope, depth + 1));
        return out;
      case 'LogicalExpression':
        merge(exprLabels(node.left, scope, depth + 1));
        merge(exprLabels(node.right, scope, depth + 1));
        return out;
      case 'ConditionalExpression':
        merge(exprLabels(node.consequent, scope, depth + 1));
        merge(exprLabels(node.alternate, scope, depth + 1));
        return out;
      case 'TemplateLiteral':
        for (const e of node.expressions) merge(exprLabels(e, scope, depth + 1));
        return out;
      case 'SequenceExpression':
        for (const e of node.expressions) merge(exprLabels(e, scope, depth + 1));
        return out;
      case 'ParenthesizedExpression':
        return exprLabels(node.expression, scope, depth + 1);
      case 'AwaitExpression':
      case 'YieldExpression':
        return exprLabels(node.argument, scope, depth + 1);
      default:
        return out;
    }
  }

  // Is this call one of our taint SOURCES? Returns the label set it introduces.
  function sourceLabelsForCall(node) {
    const out = new Set();
    const mp = memberPath(node.callee);
    if (!mp) return out;
    const parts = mp.split('.');
    const last = parts[parts.length - 1];
    const obj = parts.length >= 2 ? parts[parts.length - 2] : '';

    if ((obj === 'localStorage' || obj === 'sessionStorage') && last === 'getItem') {
      out.add('storage');
      const arg0 = node.arguments[0];
      const s = arg0 && staticString(arg0);
      if (s && s.static && s.value === 'brewser_auth') out.add('auth');
      return out;
    }
    if (DECODE_FNS.has(last)) out.add('decode');
    if (last === 'fromCharCode') out.add('decode');
    if (last === 'decode' && obj === 'TextDecoder') out.add('decode'); // rare
    if (last === 'decode' && /decoder/i.test(obj)) out.add('decode');
    if (last === 'getDevices' || last === 'getPorts') out.add('device');
    // Fetched response body reads → 'network' (reassembled-payload dataflow).
    if (last === 'text' || last === 'json' || last === 'arrayBuffer' || last === 'blob') out.add('network');
    return out;
  }

  function sourceLabelsForMember(node) {
    const out = new Set();
    const mp = memberPath(node);
    if (mp === 'document.cookie') { out.add('cookie'); return out; }
    // XHR response body reads → 'network'.
    if (node.property && node.property.type === 'Identifier' &&
        (node.property.name === 'responseText' || node.property.name === 'response')) {
      out.add('network');
    }
    // localStorage['brewser_auth'] / localStorage.brewser_auth
    if (node.object && node.object.type === 'Identifier' &&
        (node.object.name === 'localStorage' || node.object.name === 'sessionStorage')) {
      out.add('storage');
      const key = node.computed ? staticString(node.property) : { value: node.property.name, static: true };
      if (key.static && key.value === 'brewser_auth') out.add('auth');
    }
    return out;
  }

  // First traverse: gather assignment edges (binding <- valueNode + scope).
  const edges = [];
  traverse(ast, {
    VariableDeclarator(path) {
      if (path.node.id.type === 'Identifier' && path.node.init) {
        const bn = bindingNodeFor(path.scope, path.node.id.name);
        if (bn) edges.push({ bn, value: path.node.init, scope: path.scope });
      }
    },
    AssignmentExpression(path) {
      if (path.node.left.type === 'Identifier') {
        const bn = bindingNodeFor(path.scope, path.node.left.name);
        if (bn) edges.push({ bn, value: path.node.right, scope: path.scope });
      }
    },
  });

  // Fixpoint over the edges so var->var->var chains propagate.
  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    for (const e of edges) {
      const labels = exprLabels(e.value, e.scope);
      if (labels.size === 0) continue;
      let cur = taint.get(e.bn);
      if (!cur) { cur = new Set(); taint.set(e.bn, cur); }
      for (const l of labels) {
        if (!cur.has(l)) { cur.add(l); changed = true; }
      }
    }
    if (!changed) break;
  }

  // -------------------------------------------------------------------------
  // Main sink / rule pass.
  // -------------------------------------------------------------------------
  const highEntropy = { count: 0, largest: 0, sample: '' };
  let fileHasExternalEgress = false;
  let sensitiveReadInFile = false; // brewser_auth / cookie read seen in this file

  function egressUrlArg(node, argIndex) {
    return node.arguments && node.arguments.length > argIndex ? node.arguments[argIndex] : null;
  }

  // Resolve a `const url = <expr>` identifier back to its initializer so static
  // / fragment URL checks see the real value, not just the variable name. Taint
  // already follows bindings; this is only for the literal-value inspection.
  function resolveValueNode(node, scope) {
    if (node && node.type === 'Identifier') {
      const b = scope && scope.getBinding(node.name);
      if (b && b.path && b.path.node && b.path.node.type === 'VariableDeclarator' && b.path.node.init) {
        return b.path.node.init;
      }
    }
    return node;
  }

  // Emit the right finding for a network sink given its URL-argument node.
  function handleNetworkSink(callNode, urlNode, scope, sinkLabel) {
    const labels = urlNode ? exprLabels(urlNode, scope) : new Set();
    const line = lineOf(callNode);
    const ev = snippet(code, callNode);
    if (labels.has('auth')) {
      add({ rule_id: 'auth-exfil-dataflow', severity: DANGEROUS, file, line, evidence: ev,
        detail: "A read of localStorage['brewser_auth'] flows into " + sinkLabel + ' to an external/among-package origin. Highest-severity exfil pattern.' });
      return;
    }
    if (labels.has('device')) {
      add({ rule_id: 'peripheral-silent-egress', severity: DANGEROUS, file, line, evidence: ev,
        detail: 'Data from silently-granted device access (getDevices/getPorts) flows into ' + sinkLabel + '.' });
      return;
    }
    if (labels.has('storage') || labels.has('cookie')) {
      add({ rule_id: 'auth-exfil-dataflow', severity: DANGEROUS, file, line, evidence: ev,
        detail: 'A storage/cookie read flows into ' + sinkLabel + ' — potential credential/state exfiltration.' });
      return;
    }
    const effective = urlNode ? resolveValueNode(urlNode, scope) : null;
    const s = effective && staticString(effective);
    if (s && s.static) {
      if (isExternalUrl(s.value, ctx.allowlist)) {
        fileHasExternalEgress = true;
        add({ rule_id: 'external-egress', severity: SUSPICIOUS, file, line, evidence: ev,
          detail: sinkLabel + ' targets ' + s.value + ', an origin not in the manifest allowed_origins.' });
      }
      return;
    }
    // Assembled URL: only flag when a static fragment is itself external (keeps
    // the false-positive rate low — most apps build same-origin URLs at runtime).
    if (effective) {
      const frag = externalFragment(effective, ctx.allowlist);
      if (frag) {
        fileHasExternalEgress = true;
        add({ rule_id: 'external-egress-assembled', severity: SUSPICIOUS, file, line, evidence: ev,
          detail: sinkLabel + ' targets a runtime-assembled URL containing the external fragment ' + frag + '.' });
      }
    }
  }

  traverse(ast, {
    // ---- String literals: entropy + high-entropy payload detection --------
    StringLiteral(path) {
      const v = path.node.value;
      if (v && v.length > ENTROPY_MIN_LEN) {
        const ent = shannonEntropy(v);
        if (ent > ENTROPY_THRESHOLD && base64ishRatio(v) > 0.85) {
          highEntropy.count++;
          if (v.length > highEntropy.largest) { highEntropy.largest = v.length; highEntropy.sample = v; }
        }
      }
    },

    // ---- String-array-rotation obfuscation --------------------------------
    ArrayExpression(path) {
      const els = path.node.elements;
      if (els.length >= 20) {
        let escaped = 0, strs = 0;
        for (const el of els) {
          if (el && el.type === 'StringLiteral') {
            strs++;
            const raw = el.extra && el.extra.raw ? el.extra.raw : '';
            if (/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/i.test(raw)) escaped++;
          }
        }
        if (strs >= 20 && escaped / strs > 0.6) {
          add({ rule_id: 'string-array-obfuscation', severity: SUSPICIOUS, file, line: lineOf(path.node),
            detail: 'A ' + strs + '-element array of mostly hex/unicode-escaped strings — the obfuscator.io string-array pattern.',
            evidence: snippet(code, path.node) });
          path.skip();
        }
      }
    },

    // ---- Aliasing a dangerous global to a local (const f = eval; …) -------
    VariableDeclarator(path) {
      const init = path.node.init;
      if (!init) return;
      const EXEC_ALIASES = new Set(['eval', 'Function', 'importScripts']);
      let aliased = null;
      if (init.type === 'Identifier' && EXEC_ALIASES.has(init.name)) {
        aliased = init.name;
      } else if (init.type === 'MemberExpression') {
        const mp = memberPath(init);
        if (mp) {
          const parts = mp.split('.');
          const obj = parts[parts.length - 2];
          const prop = parts[parts.length - 1];
          if (['window', 'self', 'globalThis', 'top'].includes(obj) && EXEC_ALIASES.has(prop)) {
            aliased = prop;
          }
        }
      }
      if (aliased) {
        add({ rule_id: 'global-alias-sink', severity: SUSPICIOUS, file, line: lineOf(path.node),
          detail: 'Aliases the code-execution global "' + aliased + '" to a local — a common way to hide a dangerous call from a reviewer or a naive grep.',
          evidence: snippet(code, path.node) });
      }
    },

    // ---- Dynamic import with computed specifier ---------------------------
    Import(path) {
      const call = path.parentPath && path.parentPath.node;
      if (call && call.type === 'CallExpression') {
        const arg = call.arguments[0];
        const s = arg && staticString(arg);
        if (!s || !s.static) {
          add({ rule_id: 'dynamic-import-computed', severity: SUSPICIOUS, file, line: lineOf(call),
            detail: 'import() with a non-literal specifier — the module loaded is decided at runtime.',
            evidence: snippet(code, call) });
        }
      }
    },

    // ---- Member reads: auth/cookie/storage/idb/computed-sink --------------
    MemberExpression(path) {
      const node = path.node;
      // Skip the callee position of a call (handled in CallExpression) and the
      // LHS of an assignment (handled in AssignmentExpression).
      const parent = path.parent;
      const isCallee = parent && parent.type === 'CallExpression' && parent.callee === node;
      const isAssignTarget = parent && parent.type === 'AssignmentExpression' && parent.left === node;

      // brewser_auth read (always surfaced, even without egress).
      const srcLabels = sourceLabelsForMember(node);
      if (srcLabels.has('auth') && !isAssignTarget) {
        sensitiveReadInFile = true;
        add({ rule_id: 'auth-token-read', severity: SUSPICIOUS, file, line: lineOf(node),
          detail: "Reads localStorage['brewser_auth'] (the shared session envelope). Permitted, but transmitting it off-device is the highest-severity pattern — see any auth-exfil-dataflow finding.",
          evidence: snippet(code, node) });
      } else if (node.object && node.object.type === 'Identifier' && node.object.name === 'localStorage' && !isAssignTarget) {
        // Cross-namespace storage: a static key that isn't brewser_auth and
        // isn't the app's own namespace prefix.
        const key = node.computed ? staticString(node.property) : { value: node.property && node.property.name, static: true };
        if (key.static && typeof key.value === 'string' && key.value !== 'brewser_auth') {
          const ns = ctx.selfNamespace || '';
          const k = key.value;
          // Only flag keys that plausibly belong to ANOTHER app or the Brewser
          // platform: a reverse-DNS namespace (com.*) that isn't ours, or a
          // brewser_* platform key other than the auto-granted brewser_auth.
          // Ordinary short keys ("theme", "highscore") are NOT flagged — every
          // app uses those and doing so would drown the signal in false hits.
          const foreignNs = /^[a-z][a-z0-9]*\.[a-z0-9]/i.test(k) && (!ns || !k.startsWith(ns));
          const platformKey = /^brewser[_.]/i.test(k);
          if (foreignNs || platformKey) {
            add({ rule_id: 'cross-namespace-storage', severity: SUSPICIOUS, file, line: lineOf(node),
              detail: 'Accesses localStorage key "' + k + '" outside this app namespace' + (ns ? ' (' + ns + ')' : '') + ' and other than brewser_auth.',
              evidence: snippet(code, node) });
          }
        }
      }

      if (memberPath(node) === 'document.cookie' && !isCallee && !isAssignTarget) {
        sensitiveReadInFile = true;
        add({ rule_id: 'cookie-access', severity: SUSPICIOUS, file, line: lineOf(node),
          detail: 'Accesses document.cookie.', evidence: snippet(code, node) });
      }

      // devtools-detection: any access to Function.prototype.toString (used to
      // sniff whether natives have been hooked/instrumented), however it's then
      // invoked (.call/.apply or direct).
      if (memberPath(node) === 'Function.prototype.toString') {
        add({ rule_id: 'devtools-detection', severity: SUSPICIOUS, file, line: lineOf(node),
          detail: 'Accesses Function.prototype.toString — a common anti-analysis / devtools-detection trick (checking whether natives are hooked).',
          evidence: snippet(code, node) });
      }

      // .constructor.constructor eval-escape.
      if (!node.computed && node.property.type === 'Identifier' && node.property.name === 'constructor' &&
          node.object.type === 'MemberExpression' && !node.object.computed &&
          node.object.property.type === 'Identifier' && node.object.property.name === 'constructor') {
        add({ rule_id: 'constructor-escape', severity: DANGEROUS, file, line: lineOf(node),
          detail: 'Uses the .constructor.constructor chain to reach Function — a classic eval-escape.',
          evidence: snippet(code, node) });
      }

      // Computed window/self/globalThis/top[x].
      if (node.computed && node.object.type === 'Identifier' &&
          ['window', 'self', 'globalThis', 'top'].includes(node.object.name)) {
        const key = staticString(node.property);
        if (key.static && SENSITIVE_GLOBALS.has(key.value)) {
          add({ rule_id: 'computed-sink-name', severity: SUSPICIOUS, file, line: lineOf(node),
            detail: node.object.name + "['" + key.value + "'] resolves a sensitive global (" + key.value + ') through a runtime-assembled name — an obfuscation tell.',
            evidence: snippet(code, node) });
        } else if (!key.static && isCallee) {
          // Fully dynamic global lookup that is then invoked: window[x](…).
          add({ rule_id: 'global-bracket-sink', severity: SUSPICIOUS, file, line: lineOf(node),
            detail: node.object.name + '[…]() invokes a global chosen by a runtime value — the called name is hidden from static review.',
            evidence: snippet(code, node) });
        }
      }
    },

    // ---- Assignments: innerHTML/src/location/cookie sinks -----------------
    AssignmentExpression(path) {
      const node = path.node;
      if (node.left.type !== 'MemberExpression') return;
      const mp = memberPath(node.left);
      const prop = node.left.computed ? (staticString(node.left.property).value) : (node.left.property && node.left.property.name);
      const line = lineOf(node);

      if (prop === 'innerHTML' || prop === 'outerHTML') {
        const s = staticString(node.right);
        if (!s.static) {
          add({ rule_id: 'html-injection-sink', severity: INFO, file, line,
            detail: 'Assigns a non-literal value to .' + prop + ' — a DOM-based injection sink.',
            evidence: snippet(code, node) });
        }
        return;
      }
      if (prop === 'src') {
        // new Image().src = / script.src = with external or tainted URL.
        handleNetworkSink(node, node.right, path.scope, 'an image/script src assignment');
        return;
      }
      if (mp === 'document.cookie') {
        add({ rule_id: 'cookie-access', severity: SUSPICIOUS, file, line,
          detail: 'Writes document.cookie.', evidence: snippet(code, node) });
        return;
      }
      if (mp === 'location' || mp === 'location.href' || mp === 'window.location' ||
          mp === 'window.location.href' || mp === 'document.location' || mp === 'document.location.href' ||
          prop === 'href' && /location/.test(mp || '')) {
        const ext = externalFragment(node.right, ctx.allowlist) || (staticString(node.right).static && isExternalUrl(staticString(node.right).value, ctx.allowlist) ? staticString(node.right).value : null);
        if (ext) {
          add({ rule_id: 'external-redirect', severity: SUSPICIOUS, file, line,
            detail: 'Redirects the window to ' + ext + ', an external origin.', evidence: snippet(code, node) });
        }
      }
    },

    // ---- Calls: the bulk of the sink logic --------------------------------
    CallExpression(path) {
      const node = path.node;
      const line = lineOf(node);
      const callee = node.callee;
      const simpleName = callee.type === 'Identifier' ? callee.name : null;
      const mp = memberPath(callee);
      const parts = mp ? mp.split('.') : [];
      const last = parts.length ? parts[parts.length - 1] : simpleName;
      const objName = parts.length >= 2 ? parts[parts.length - 2] : '';

      // Self-decoding IIFE: (function(){ … atob(…) … eval(…) … })() — a function
      // that decodes then executes its own body, invoked immediately.
      if ((callee.type === 'FunctionExpression' || callee.type === 'ArrowFunctionExpression') && callee.body) {
        if (subtreeHasCallName(callee.body, DECODE_FNS) && subtreeHasCallName(callee.body, EXEC_SINKS)) {
          add({ rule_id: 'self-decoding-iife', severity: SUSPICIOUS, file, line,
            detail: 'An immediately-invoked function decodes data and executes it within its own body — a self-decoding payload.',
            evidence: snippet(code, node) });
        }
      }

      // localStorage.getItem('brewser_auth') / sessionStorage.getItem(...) — the
      // CALL form (the member form is handled in MemberExpression).
      if (last === 'getItem' && (objName === 'localStorage' || objName === 'sessionStorage')) {
        const a0 = node.arguments[0];
        const ks = a0 && staticString(a0);
        if (ks && ks.static && ks.value === 'brewser_auth') {
          sensitiveReadInFile = true;
          add({ rule_id: 'auth-token-read', severity: SUSPICIOUS, file, line,
            detail: "Reads localStorage.getItem('brewser_auth') (the shared session envelope). Permitted, but transmitting it off-device is the highest-severity pattern — see any auth-exfil-dataflow finding.",
            evidence: snippet(code, node) });
        } else if (ks && ks.static && typeof ks.value === 'string') {
          const k = ks.value;
          const foreignNs = /^[a-z][a-z0-9]*\.[a-z0-9]/i.test(k) && (!ctx.selfNamespace || !k.startsWith(ctx.selfNamespace));
          const platformKey = /^brewser[_.]/i.test(k);
          if (foreignNs || platformKey) {
            add({ rule_id: 'cross-namespace-storage', severity: SUSPICIOUS, file, line,
              detail: 'Reads localStorage key "' + k + '" outside this app namespace' + (ctx.selfNamespace ? ' (' + ctx.selfNamespace + ')' : '') + ' and other than brewser_auth.',
              evidence: snippet(code, node) });
          }
        }
        return;
      }

      // eval(...)
      if (simpleName === 'eval' || (callee.type === 'MemberExpression' && last === 'eval')) {
        const arg = node.arguments[0];
        const labels = arg ? exprLabels(arg, path.scope) : new Set();
        const s = arg && staticString(arg);
        if (labels.has('decode')) {
          add({ rule_id: 'decode-exec', severity: DANGEROUS, file, line,
            detail: 'Decoded data (atob/decodeURIComponent/fromCharCode/…) flows into eval() — the classic obfuscated-payload pattern.',
            evidence: snippet(code, node) });
        } else if (labels.has('network')) {
          add({ rule_id: 'reassembled-payload', severity: DANGEROUS, file, line,
            detail: 'Data fetched from the network flows into eval() — remotely-delivered code executed at runtime.',
            evidence: snippet(code, node) });
        } else if (!s || !s.static) {
          add({ rule_id: 'eval-nonliteral', severity: SUSPICIOUS, file, line,
            detail: 'eval() of a non-literal expression: the executed code is decided at runtime.',
            evidence: snippet(code, node) });
        } else {
          add({ rule_id: 'eval-literal', severity: INFO, file, line,
            detail: 'eval() of a literal string — still avoidable; review intent.', evidence: snippet(code, node) });
        }
        return;
      }

      // Function(...) / new Function is caught in NewExpression; direct call here.
      if (simpleName === 'Function') {
        handleCodeCtor(node, path.scope);
        return;
      }

      // setTimeout/setInterval with string first arg (implicit eval).
      if (simpleName === 'setTimeout' || simpleName === 'setInterval' ||
          (callee.type === 'MemberExpression' && (last === 'setTimeout' || last === 'setInterval'))) {
        const arg = node.arguments[0];
        const labels = arg ? exprLabels(arg, path.scope) : new Set();
        const s = arg && staticString(arg);
        const isStringArg = arg && (arg.type === 'StringLiteral' || arg.type === 'TemplateLiteral' ||
          (s && s.static) || (arg.type === 'BinaryExpression'));
        if (labels.has('decode')) {
          add({ rule_id: 'decode-exec', severity: DANGEROUS, file, line,
            detail: 'Decoded data flows into ' + last + '() with a string body (implicit eval).', evidence: snippet(code, node) });
        } else if (isStringArg && arg && arg.type !== 'FunctionExpression' && arg.type !== 'ArrowFunctionExpression' && arg.type !== 'Identifier') {
          add({ rule_id: 'settimeout-string', severity: SUSPICIOUS, file, line,
            detail: last + '() called with a string first argument — the string is eval()-ed.', evidence: snippet(code, node) });
        }
        return;
      }

      // Network sinks.
      if (simpleName === 'fetch' || (callee.type === 'MemberExpression' && last === 'fetch')) {
        handleNetworkSink(node, egressUrlArg(node, 0), path.scope, 'fetch()');
        return;
      }
      if (last === 'sendBeacon') {
        handleNetworkSink(node, egressUrlArg(node, 0), path.scope, 'navigator.sendBeacon()');
        return;
      }
      if (last === 'open' && (objName || callee.type === 'MemberExpression')) {
        // xhr.open(method, url) — URL is arg 1. window.open(url) — arg 0.
        if (objName === 'window' || simpleName === 'open') {
          const s = staticString(egressUrlArg(node, 0));
          if (s.static && isExternalUrl(s.value, ctx.allowlist)) {
            add({ rule_id: 'external-window-open', severity: INFO, file, line,
              detail: 'window.open() to external origin ' + s.value + '.', evidence: snippet(code, node) });
          }
        } else {
          handleNetworkSink(node, egressUrlArg(node, 1), path.scope, 'XMLHttpRequest.open()');
        }
        return;
      }

      // importScripts / WebAssembly.instantiate|compile from external/decoded.
      if (last === 'importScripts') {
        const s = staticString(egressUrlArg(node, 0));
        if (s.static && isExternalUrl(s.value, ctx.allowlist)) {
          fileHasExternalEgress = true;
          add({ rule_id: 'external-egress', severity: SUSPICIOUS, file, line,
            detail: 'importScripts() loads code from external origin ' + s.value + '.', evidence: snippet(code, node) });
        }
        return;
      }
      if (objName === 'WebAssembly' && (last === 'instantiate' || last === 'compile' || last === 'instantiateStreaming' || last === 'compileStreaming')) {
        const arg = node.arguments[0];
        const labels = arg ? exprLabels(arg, path.scope) : new Set();
        const frag = arg ? externalFragment(arg, ctx.allowlist) : null;
        if (labels.has('decode') || frag) {
          add({ rule_id: 'wasm-remote', severity: SUSPICIOUS, file, line,
            detail: 'WebAssembly.' + last + ' from a ' + (labels.has('decode') ? 'decoded blob' : 'remote source (' + frag + ')') + '.',
            evidence: snippet(code, node) });
        }
        return;
      }

      // document.write / insertAdjacentHTML with non-literal.
      if (last === 'write' && objName === 'document') {
        const arg = node.arguments[0];
        if (arg && !staticString(arg).static) {
          add({ rule_id: 'html-injection-sink', severity: INFO, file, line,
            detail: 'document.write() of a non-literal value.', evidence: snippet(code, node) });
        }
        return;
      }
      if (last === 'insertAdjacentHTML') {
        const arg = node.arguments[1];
        if (arg && !staticString(arg).static) {
          add({ rule_id: 'html-injection-sink', severity: INFO, file, line,
            detail: 'insertAdjacentHTML() of a non-literal value.', evidence: snippet(code, node) });
        }
        return;
      }

      // indexedDB.databases() enumeration.
      if (last === 'databases' && objName === 'indexedDB') {
        add({ rule_id: 'indexeddb-enumeration', severity: SUSPICIOUS, file, line,
          detail: 'Enumerates all IndexedDB databases (indexedDB.databases()).', evidence: snippet(code, node) });
        return;
      }

      // Peripheral APIs: navigator.usb/serial/hid/bluetooth.* and NDEFReader.
      if (parts.length >= 3 && parts[parts.length - 3] === 'navigator' && isPeripheralNavProp(parts[parts.length - 2])) {
        const fam = PERIPHERAL_APIS[parts[parts.length - 2]].family;
        peripheralsUsed.add(fam);
        recordPeripheralUse(fam, node, line);
        return;
      }

      // String.fromCharCode(a,b,c,...) reconstruction.
      if (last === 'fromCharCode' && node.arguments.length >= 8) {
        add({ rule_id: 'charcode-reconstruction', severity: SUSPICIOUS, file, line,
          detail: 'String.fromCharCode() with ' + node.arguments.length + ' arguments — reconstructs a string/identifier from char codes.',
          evidence: snippet(code, node) });
        return;
      }

    },

    NewExpression(path) {
      const node = path.node;
      const line = lineOf(node);
      const callee = node.callee;
      const name = callee.type === 'Identifier' ? callee.name : memberPath(callee);

      if (name === 'Function') { handleCodeCtor(node, path.scope); return; }
      if (name === 'WebSocket') { handleNetworkSink(node, node.arguments[0], path.scope, 'new WebSocket()'); return; }
      if (name === 'EventSource') { handleNetworkSink(node, node.arguments[0], path.scope, 'new EventSource()'); return; }
      if (name === NFC_CTOR) {
        peripheralsUsed.add('nfc');
        recordPeripheralUse('nfc', node, line);
        return;
      }
    },

    // ---- Conditional-trigger / time-bomb gating ---------------------------
    IfStatement(path) { gateCheck(path.node.test, path.node.consequent, add, file, code); },
    ConditionalExpression(path) { gateCheck(path.node.test, path.node.consequent, add, file, code); },
    LogicalExpression(path) {
      if (path.node.operator === '&&') gateCheck(path.node.left, path.node.right, add, file, code);
    },

    // ---- Unbounded loops (resource abuse) ---------------------------------
    WhileStatement(path) { unboundedLoop(path, add, file, code); },
    ForStatement(path) { if (path.node.test === null) unboundedLoop(path, add, file, code); },
  });

  function handleCodeCtor(node, scope) {
    const line = lineOf(node);
    const anyNonStatic = node.arguments.some((a) => !staticString(a).static);
    const anyDecode = node.arguments.some((a) => exprLabels(a, scope).has('decode'));
    const anyNetwork = node.arguments.some((a) => exprLabels(a, scope).has('network'));
    if (anyDecode) {
      add({ rule_id: 'decode-exec', severity: DANGEROUS, file, line,
        detail: 'Decoded data flows into Function() — code built from an obfuscated payload.', evidence: snippet(code, node) });
    } else if (anyNetwork) {
      add({ rule_id: 'reassembled-payload', severity: DANGEROUS, file, line,
        detail: 'Network-fetched data flows into Function() — remotely-delivered code executed at runtime.', evidence: snippet(code, node) });
    } else if (anyNonStatic && node.arguments.length > 0) {
      add({ rule_id: 'function-constructor', severity: SUSPICIOUS, file, line,
        detail: 'Function() constructs code from a non-literal — a runtime-decided code path.', evidence: snippet(code, node) });
    }
  }

  function recordPeripheralUse(fam, node, line) {
    const declared = ctx.declaredPeripheralFamilies.has(fam);
    if (!declared) {
      add({ rule_id: 'peripheral-undeclared', severity: SUSPICIOUS, file, line,
        detail: 'Uses the ' + fam + ' peripheral API but the manifest declares no matching permission. Undeclared peripheral use is suspicious; combined with off-package egress it is treated as dangerous.',
        evidence: snippet(code, node) });
    }
  }

  // File-level entropy summary (one finding per file, not per literal).
  if (highEntropy.count > 0) {
    add({ rule_id: 'high-entropy-string', severity: INFO, file, line: 0,
      detail: highEntropy.count + ' high-entropy base64-like string literal(s); largest ' + highEntropy.largest + ' chars. Possible packed/encoded payload.',
      evidence: highEntropy.sample });
  }

  // File-level escalation: a brewser_auth / cookie read AND off-package egress
  // in the same file is treated as exfiltration even when the value passes
  // through a function boundary the intra-function taint can't follow. Only
  // add it if the precise taint pass didn't already produce one.
  if (fileHasExternalEgress && sensitiveReadInFile &&
      !findings.some((f) => f.rule_id === 'auth-exfil-dataflow')) {
    add({ rule_id: 'auth-exfil-dataflow', severity: DANGEROUS, file, line: 0,
      detail: 'This file both reads the session envelope / cookies AND performs off-package network egress. Even if the value is threaded through a function boundary, this is the token-exfiltration shape and is blocked.',
      evidence: 'auth/cookie read + external egress in ' + file });
  }

  // Escalation: undeclared peripheral use + external egress in the same file.
  if (fileHasExternalEgress && peripheralsUsed.size) {
    for (const f of findings) {
      if (f.rule_id === 'peripheral-undeclared' && f.severity !== DANGEROUS) {
        f.severity = DANGEROUS;
        f.detail += ' [Escalated: this file also performs off-package network egress.]';
      }
    }
  }

  return { findings, peripheralsUsed };
}

// Gate predicate: does this test look like a time/host/platform/random trigger?
function gatePredicate(test) {
  const src = { time: false, host: false, platform: false, random: false };
  function walk(n, depth = 0) {
    if (!n || typeof n !== 'object' || depth > 25) return;
    if (n.type === 'CallExpression') {
      const c = n.callee;
      const cm = c && c.type === 'MemberExpression' ? (c.object && c.object.name) + '.' + (c.property && c.property.name) : (c && c.name);
      if (cm === 'Date.now') src.time = true;
      if (cm === 'Math.random') src.random = true;
    }
    if (n.type === 'NewExpression' && n.callee && n.callee.name === 'Date') src.time = true;
    if (n.type === 'MemberExpression') {
      const mp = (n.object && n.object.name) + '.' + (n.property && n.property.name);
      if (mp === 'location.hostname' || mp === 'location.host' || mp === 'location.origin' ||
          (n.object && n.object.type === 'MemberExpression' && n.property && (n.property.name === 'hostname' || n.property.name === 'host'))) src.host = true;
      if (mp === 'navigator.userAgent' || mp === 'navigator.platform' || (n.property && n.property.name === 'userAgent')) src.platform = true;
      if (n.property && n.property.name === '__brewserPlatform') src.platform = true;
    }
    for (const k in n) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
      else if (v && typeof v.type === 'string') walk(v, depth + 1);
    }
  }
  walk(test);
  return src;
}

// Does a subtree contain an exec/network sink? (used to gate the gate rules so
// they only fire when the guarded branch actually does something dangerous).
function subtreeHasSink(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 30) return false;
  if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    const c = node.callee;
    const name = c && (c.name || (c.property && c.property.name));
    if (name && (EXEC_SINKS.has(name) || ['fetch', 'sendBeacon', 'WebSocket', 'EventSource', 'write', 'importScripts'].includes(name))) return true;
  }
  for (const k in node) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const x of v) if (subtreeHasSink(x, depth + 1)) return true; }
    else if (v && typeof v.type === 'string') { if (subtreeHasSink(v, depth + 1)) return true; }
  }
  return false;
}

function gateCheck(test, body, add, file, code) {
  const g = gatePredicate(test);
  if (!(g.time || g.host || g.platform || g.random)) return;
  if (!subtreeHasSink(body) && !subtreeHasSink(test)) return;
  const line = test && test.loc ? test.loc.start.line : 0;
  const ev = code.slice(test.start, Math.min(test.end, test.start + 160));
  if (g.random) add(makeFinding({ rule_id: 'random-gated-sink', severity: SUSPICIOUS, file, line, detail: 'A code path containing a sink is gated behind Math.random() — a low-probability trigger that evades manual review.', evidence: ev }));
  if (g.time) add(makeFinding({ rule_id: 'time-gated-code', severity: SUSPICIOUS, file, line, detail: 'A code path containing a sink is gated on a date/time comparison — behaves benignly during review, differently later.', evidence: ev }));
  if (g.host) add(makeFinding({ rule_id: 'host-gated-code', severity: SUSPICIOUS, file, line, detail: 'A code path containing a sink is gated on hostname/origin — may behave differently in Chrome vs on-device vs on brewser.tech.', evidence: ev }));
  if (g.platform) add(makeFinding({ rule_id: 'platform-gated-code', severity: SUSPICIOUS, file, line, detail: 'A code path containing a sink is gated on userAgent/platform sniffing — may only misbehave on the Switch build.', evidence: ev }));
}

// Does a subtree contain a call whose (simple or member-tail) name is in `names`?
function subtreeHasCallName(node, names, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 30) return false;
  if (node.type === 'CallExpression' && node.callee) {
    const c = node.callee;
    const name = c.type === 'Identifier' ? c.name
      : (c.type === 'MemberExpression' && c.property && c.property.type === 'Identifier' ? c.property.name : null);
    if (name && names.has(name)) return true;
  }
  for (const k in node) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const x of v) if (subtreeHasCallName(x, names, depth + 1)) return true; }
    else if (v && typeof v.type === 'string') { if (subtreeHasCallName(v, names, depth + 1)) return true; }
  }
  return false;
}

function unboundedLoop(path, add, file, code) {
  const node = path.node;
  // while(true)/for(;;) with no await/yield/break/return reachable in the body.
  const test = node.test;
  const isTrue = !test || (test.type === 'BooleanLiteral' && test.value === true) ||
    (test.type === 'NumericLiteral' && test.value !== 0);
  if (!isTrue) return;
  let hasEscape = false;
  path.traverse({
    'BreakStatement|ReturnStatement|AwaitExpression|YieldExpression'() { hasEscape = true; },
  });
  if (!hasEscape) {
    add(makeFinding({ rule_id: 'unbounded-loop', severity: INFO, file, line: lineOf(node),
      detail: 'Unbounded loop with no reachable break/return/await/yield — possible resource-abuse / busy-spin.',
      evidence: code.slice(node.start, Math.min(node.end, node.start + 120)) }));
  }
}

// Regex backstop for when the parser fails entirely: only the crown-jewel
// patterns, so parser-breaking obfuscation still can't hide them.
function regexBackstop(code, file, ctx, add) {
  if (/eval\s*\(\s*(atob|decodeURIComponent|unescape)\s*\(/.test(code)) {
    add({ rule_id: 'decode-exec', severity: DANGEROUS, file, line: 0,
      detail: 'Regex backstop: eval(atob(...)) / eval(decode...) decode-then-execute chain in an unparseable file.',
      evidence: (code.match(/eval\s*\(\s*(?:atob|decodeURIComponent|unescape)\s*\([^)]{0,80}/) || [''])[0] });
  }
  if (/brewser_auth/.test(code) && /(fetch|sendBeacon|WebSocket|XMLHttpRequest|new\s+Image)/.test(code)) {
    add({ rule_id: 'auth-exfil-dataflow', severity: DANGEROUS, file, line: 0,
      detail: 'Regex backstop: an unparseable file references brewser_auth AND a network sink — possible token exfiltration hidden behind broken syntax.',
      evidence: (code.match(/brewser_auth[\s\S]{0,80}/) || [''])[0] });
  }
}
