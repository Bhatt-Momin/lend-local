/**
 * LendLocal Web - Safe Math Expression Evaluator
 * Evaluates arithmetic expressions (+, -, *, /, (, )) without eval() or Function().
 * Enforces integer paise safety and 2 decimal place rounding.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.evaluateMathExpression = factory().evaluateMathExpression;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function tokenize(expression) {
    const tokens = [];
    let pos = 0;
    const len = expression.length;

    while (pos < len) {
      const ch = expression[pos];

      if (ch === ' ' || ch === '\t') {
        pos++;
        continue;
      }

      if (/^\d/.test(ch) || ch === '.') {
        let numStr = '';
        let hasDot = false;
        while (pos < len && (/^\d/.test(expression[pos]) || expression[pos] === '.')) {
          if (expression[pos] === '.') {
            if (hasDot) {
              return { tokens: [], error: 'Malformed number: multiple decimals' };
            }
            hasDot = true;
          }
          numStr += expression[pos];
          pos++;
        }
        const num = Number(numStr);
        if (!Number.isFinite(num)) {
          return { tokens: [], error: 'Invalid number' };
        }
        tokens.push({ type: 'number', value: num });
        continue;
      }

      if ('+-*/()'.includes(ch)) {
        tokens.push({ type: ch, value: ch });
        pos++;
        continue;
      }

      return { tokens: [], error: 'Illegal character: "' + ch + '"' };
    }

    return { tokens: tokens };
  }

  function precedence(op) {
    if (op === '+' || op === '-') return 1;
    if (op === '*' || op === '/') return 2;
    return 0;
  }

  function applyOperator(op, b, a) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) throw new Error('Division by zero');
        return a / b;
      default: return null;
    }
  }

  function evaluateMathExpression(input) {
    if (typeof input !== 'string' || input.trim() === '') {
      return { valid: false, error: 'Expression is required' };
    }

    const trimmed = input.trim();

    if (!/^[\d\s+\-*/().]+$/.test(trimmed)) {
      return { valid: false, error: 'Expression contains illegal characters. Allowed: 0-9, +, -, *, /, (, ), .' };
    }

    const tokResult = tokenize(trimmed);
    if (tokResult.error) {
      return { valid: false, error: tokResult.error };
    }

    const tokens = tokResult.tokens;
    if (tokens.length === 0) {
      return { valid: false, error: 'Empty expression' };
    }

    const output = [];
    const operators = [];

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];

      if (tok.type === 'number') {
        output.push(tok.value);
      } else if (tok.type === '(') {
        operators.push(tok.value);
      } else if (tok.type === ')') {
        let foundOpen = false;
        while (operators.length > 0) {
          const op = operators.pop();
          if (op === '(') {
            foundOpen = true;
            break;
          }
          if (output.length < 2) {
            return { valid: false, error: 'Malformed expression: not enough operands' };
          }
          const b = output.pop();
          const a = output.pop();
          try {
            output.push(applyOperator(op, b, a));
          } catch (e) {
            return { valid: false, error: e.message };
          }
        }
        if (!foundOpen) {
          return { valid: false, error: 'Missing opening parenthesis' };
        }
      } else {
        if (tok.type === '-' && (i === 0 || tokens[i - 1].type === '(' || '+-*/'.includes(tokens[i - 1].type))) {
          output.push(0);
        }
        while (operators.length > 0) {
          const topOp = operators[operators.length - 1];
          if (precedence(topOp) >= precedence(tok.value)) {
            const op = operators.pop();
            if (output.length < 2) {
              return { valid: false, error: 'Malformed expression: not enough operands' };
            }
            const b = output.pop();
            const a = output.pop();
            try {
              output.push(applyOperator(op, b, a));
            } catch (e) {
              return { valid: false, error: e.message };
            }
          } else {
            break;
          }
        }
        operators.push(tok.value);
      }
    }

    while (operators.length > 0) {
      const op = operators.pop();
      if (op === '(' || op === ')') {
        return { valid: false, error: 'Mismatched parentheses' };
      }
      if (output.length < 2) {
        return { valid: false, error: 'Malformed expression: not enough operands' };
      }
      const b = output.pop();
      const a = output.pop();
      try {
        output.push(applyOperator(op, b, a));
      } catch (e) {
        return { valid: false, error: e.message };
      }
    }

    if (output.length !== 1) {
      return { valid: false, error: 'Malformed expression' };
    }

    const resultValue = output[0];
    if (resultValue < 0) {
      return { valid: false, error: 'Expression resulted in a negative value' };
    }

    const rounded = Math.round(resultValue * 100) / 100;
    return { valid: true, value: rounded };
  }

  return { evaluateMathExpression: evaluateMathExpression };
});
