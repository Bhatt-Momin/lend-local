/**
 * Safe math expression evaluator using the Shunting-Yard algorithm.
 * No eval() or Function() used.
 * Supports: positive numbers, decimals, +, -, *, /, (, )
 * Automatically rounds results to 2 decimal places.
 * Rejects illegal characters, divide-by-zero, and malformed parentheses.
 */

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

    return { tokens: [], error: `Illegal character: "${ch}"` };
  }

  return { tokens };
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

/**
 * Evaluates an arithmetic expression string safely.
 * @param {string} input - Expression (e.g. "12+34", "150*2-10", "(120+45)/3")
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
function evaluateMathExpression(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return { valid: false, error: 'Expression is required' };
  }

  const trimmed = input.trim();

  // Allowed characters only
  if (!/^[\d\s+\-*/().]+$/.test(trimmed)) {
    return { valid: false, error: 'Expression contains illegal characters. Allowed: 0-9, +, -, *, /, (, ), .' };
  }

  const { tokens, error: tokError } = tokenize(trimmed);
  if (tokError) {
    return { valid: false, error: tokError };
  }

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
      // Unary minus handling (e.g., at start or after an opening parenthesis)
      if (tok.type === '-' && (i === 0 || tokens[i - 1].type === '(' || '+-*/'.includes(tokens[i - 1].type))) {
        // Treat as 0 - next
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

module.exports = { evaluateMathExpression };
if (typeof exports !== 'undefined') {
  exports.evaluateMathExpression = evaluateMathExpression;
}
