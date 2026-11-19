/* A small, safe LaTeX-ish math renderer for equation blocks (no external fonts or libraries). */
import { escapeHtml } from './html';

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  neq: '≠', ne: '≠', approx: '≈', equiv: '≡', infty: '∞', partial: '∂', nabla: '∇',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐',
  sum: '∑', prod: '∏', int: '∫', oint: '∮', sqrt: '√', angle: '∠', degree: '°', prime: '′',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', cap: '∩', cup: '∪', subset: '⊂',
  supset: '⊃', in: '∈', notin: '∉', emptyset: '∅', therefore: '∴', because: '∵',
  ldots: '…', cdots: '⋯', quad: ' ', qquad: '  ', text: '', mathrm: '', operatorname: '',
};

function parseGroup(src: string, start: number): { value: string; end: number } {
  let i = start;
  while (i < src.length && src[i] === ' ') i++;
  if (src[i] !== '{') {
    const m = /^\\?[A-Za-z0-9]/.exec(src.slice(i));
    return { value: m?.[0] ?? '', end: i + (m?.[0].length ?? 0) };
  }
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return { value: src.slice(i + 1, j), end: j + 1 };
}

function renderMath(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      if (!m) { out += '\\'; i++; continue; }
      const name = m[1];
      i += m[0].length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const a = parseGroup(src, i); i = a.end;
        const b = parseGroup(src, i); i = b.end;
        out += `<span class="eq-frac"><span class="eq-num">${renderMath(a.value)}</span><span class="eq-den">${renderMath(b.value)}</span></span>`;
        continue;
      }
      if (name === 'sqrt') {
        const a = parseGroup(src, i); i = a.end;
        out += `<span class="eq-sqrt"><span class="eq-rad">√</span><span class="eq-radicand">${renderMath(a.value)}</span></span>`;
        continue;
      }
      if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
        const a = parseGroup(src, i); i = a.end;
        out += `<span class="eq-text">${escapeHtml(a.value)}</span>`;
        continue;
      }
      if (name === 'left' || name === 'right') continue;
      if (name === 'sum' || name === 'prod' || name === 'int' || name === 'oint') {
        let sub = '';
        let sup = '';
        while (i < src.length) {
          if (src[i] === '_') {
            const g = parseGroup(src, i + 1); sub = g.value; i = g.end;
          } else if (src[i] === '^') {
            const g = parseGroup(src, i + 1); sup = g.value; i = g.end;
          } else break;
        }
        out += `<span class="eq-bigop"><span class="eq-lim eq-lim--sup">${renderMath(sup)}</span>${SYMBOLS[name]}<span class="eq-lim eq-lim--sub">${renderMath(sub)}</span></span>`;
        continue;
      }
      if (SYMBOLS[name] !== undefined) {
        out += SYMBOLS[name];
        continue;
      }
      out += escapeHtml(name);
      continue;
    }
    if (ch === '^' || ch === '_') {
      const g = parseGroup(src, i + 1);
      const tag = ch === '^' ? 'sup' : 'sub';
      out += `<${tag}>${renderMath(g.value)}</${tag}>`;
      i = g.end;
      continue;
    }
    if (ch === '{' || ch === '}') { i++; continue; }
    if (ch === '&') { out += ' '; i++; continue; }
    if (ch === '\n') { out += '<br>'; i++; continue; }
    out += escapeHtml(ch);
    i++;
  }
  return out;
}

export function renderEquation(source: string): string {
  const src = source.replace(/\\\\/g, '\n');
  return renderMath(src);
}

export function equationIsEmpty(source: string): boolean {
  return source.trim() === '';
}
