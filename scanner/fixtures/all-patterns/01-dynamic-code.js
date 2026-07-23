// Dynamic code construction (§1.3).
// Rules: eval-nonliteral, eval-literal, function-constructor,
//        settimeout-string, dynamic-import-computed, html-injection-sink

var userInput = location.hash.slice(1);

// eval-nonliteral
eval(userInput);

// eval-literal (INFO — literal string eval)
eval('1 + 1');

// function-constructor (non-literal body)
var build = new Function(userInput);
build();

// settimeout-string (implicit eval of a string)
setTimeout("doWork()", 500);

// dynamic-import-computed (computed specifier)
import('./' + userInput + '.js');

// html-injection-sink (INFO — non-literal innerHTML)
document.getElementById('go').innerHTML = userInput;
