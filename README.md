# The Cipher Laboratory

An interactive, educational website documenting two classical cipher machines — a **Caesar substitution cipher** and an **Enigma-inspired three-rotor rotor machine**. Every message is processed step by step, and the site visualises the exact path the signal takes through each rotor.

Built as four plain files. No frameworks, no build step — open `index.html` in any modern browser and it runs.

- `index.html` — page structure, dial and machine SVG shells
- `style.css` — the vintage laboratory design system
- `script.js` — the cipher engine, visualisation and UI (single IIFE, also loadable in Node)
- `README.md` — this file

---

## Running

**In the browser**

Open `index.html`. The page runs an instrument self-test on load and reports the result in the footer.

**From a terminal (engine only)**

The engine does not touch the DOM, so it can be exercised directly in Node:

```
node -e "const api = require('./script.js'); const r = api.runSelfTests(() => {}); console.log(r.passed, 'passed');"
```

Ciphers from the console:

```js
const api = require('./script.js');

const out = api.rotorEncryptionPipeline('ATTACK AT DAWN', {
  rotors: [
    { name: 'I',   position: 0 }, // A
    { name: 'II',  position: 0 }, // A
    { name: 'III', position: 0 }, // A
  ],
  reflector: 'B',
  plugboard: '',                  // or e.g. 'AB CD'
}, {});
console.log(out.output);
```

Reference vector used by the self-tests: rotors **I · II · III**, positions **AAA**, reflector **B**, no plugboard
encrypt `AAAAA` to **`BDZGO`**, and decryption of `BDZGO` restores `AAAAA`.

---

## Conventions

- The alphabet is `A..Z`, mapped to the integers `0..25` (`A = 0`, `Z = 25`).
- All arithmetic is modulo 26.
- Rotors render in **left · middle · right** order, matching the passage of a signal through the physical machine (right is the fast rotor that steps every letter).
- Reflectors are involutions with no fixed letters.
- The plugboard swaps pairs of letters *before* the entry rotor and again *after* the reflector on output.

## The Caesar workbench

Substitution cipher with shift K:

```
encrypt:  C = (P + K) mod 26
decrypt:  C = (P - K) mod 26
```

Upper and lower case are preserved in the output; spaces, digits and punctuation pass through untouched. The
dial shows both alphabet rings rotating relative to each other, and the character trace shows `plain` → `shift` →
`cipher` per letter. The four pipeline functions are:

- `caesarEncryptionPipeline(input, shift, options)`
- `caesarDecryptionPipeline(input, shift, options)`

## The rotor machine

An *Enigma-inspired* three-rotor model.

### Rotor maths

For a ring at position `p`:

```
forward rotor:    w[x + p]  − p        (mod 26)
backward rotor:   inv[x + p] − p       (mod 26),  where inv is the inverse permutation of w
reflector:        involution, applied directly
```

So each rotor's rotation is modelled by shifting the input **into** the wheel frame, looking up the fixed wiring for
that frame, and shifting the result back into the machine frame.

### Stepping

Implements the historical **Enigma I / double-step** behaviour of the right-hand fast rotor:

1. Before every alphabetic character, the **right** rotor always advances one step.
2. If the **middle** rotor is on its notch, the **left and middle** both advance. (Extra middle-move is the "double step".)
3. Otherwise, if the **right** rotor is on its notch, the **middle** advances.
4. Non-alphabetic characters are preserved and do **not** step any rotor.

The stepping order is resolved before each character, so the illustration in the character trace shows
`before → after`.

### Rotor stages

The signal pipeline has nine stages: `plugboard in → right → middle → left → reflector → left → middle → right →
plugboard out`. Visualisations draw the forward path in amber and the return path (after the reflector) in teal, so the
round trip through the machine is directly visible.

### Pipeline functions

- `rotorEncryptionPipeline(input, configuration, options)`
- `rotorDecryptionPipeline(input, configuration, options)`

`configuration` shape:

```js
{
  rotors: [
    { name: 'I',   position: 0 },   // position: 0..25 (A..Z)
    { name: 'II',  position: 0 },
    { name: 'III', position: 0 },
  ],
  reflector: 'B',                   // 'A' | 'B' | 'C'
  plugboard: 'AB CD'                // string, '' for none
}
```

Available rotors: **I..V** with their historical wirings and notches; reflectors **A/B/C** as included with the
commercial Enigma models.

### Trace records

Both pipelines return:

```js
{
  output:            string,   // transformed text, case preserved
  configuration:     {...},    // normalised config
  options:           {...},
  metadata: { characters, alphabetic },
  initialState: { rotors: [{ name, position }...], reflector, plugboard },
  finalState:  { rotors: [{ name, position }...], reflector, plugboard },
  trace: [ entry, entry, ... ] // one per input character
}
```

Caesar trace entries: `char, upper, index, shifted, outIndex, outLetter, isAlpha`.

Rotor trace entries: `char, upper, isAlpha, plugIn, plugOut, stepBefore, stepAfter, stepped, forward, reflector,
reverse, outIndex, outLetter` — where `forward`/`reverse` are arrays of `{ in, out }` per rotor and `reflector`
is `{ in, out }`. This exposes the full per-letter route for the visualisation.

## The encryption / decryption source

The complete process logic behind the four pipeline functions, copied from `script.js` (sections 1–3). No DOM, no
visualisation, no self-test output — just the cipher maths. This is the code that actually does the work; the page UI
only calls these functions and never re-implements the ciphers.

```js
/* ============================================================
   THE CIPHER LABORATORY — encryption / decryption engine
   ============================================================ */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';   // A = 0 ... Z = 25
const MOD = 26;

const ROTOR_WIRINGS = {
  I:   { wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ', notch: 'Q' },
  II:  { wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE', notch: 'E' },
  III: { wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO', notch: 'V' },
  IV:  { wiring: 'ESOVPZJAYQUIRHXLNFTGKDCMWB', notch: 'J' },
  V:   { wiring: 'VZBRGITYUPSDNHLXAWMJQOFECK', notch: 'Z' }
};

const REFLECTORS = {
  A: 'EJMZALYXVBWFCRQUONTSPIKHGD',
  B: 'YRUHQSLDPXNGOKMIEBFZCWVJAT',
  C: 'FVPJIAOYEDRZXWGCTKUQSBNMHL'
};

function mod(n, m) { return ((n % m) + m) % m; }
function isAlpha(ch) { return /[A-Za-z]/.test(ch); }
function charIndex(ch) { return ALPHABET.indexOf(ch.toUpperCase()); }
function indexLetter(i) { return ALPHABET[mod(i, MOD)]; }
function normalizeShift(shift) { return mod(parseInt(shift, 10) || 0, MOD); }

function isPermutation(wiring) {
  if (typeof wiring !== 'string' || wiring.length !== MOD) return false;
  const seen = new Array(MOD).fill(false);
  for (let i = 0; i < wiring.length; i++) {
    if (!isAlpha(wiring[i])) return false;
    const idx = charIndex(wiring[i]);
    if (seen[idx]) return false;
    seen[idx] = true;
  }
  return true;
}

/* Inverse wiring: inv[ wiring[i] ] = i for every i. */
function buildInverse(wiring) {
  const inv = new Array(MOD);
  for (let i = 0; i < MOD; i++) inv[charIndex(wiring[i])] = i;
  return inv;
}

function makeRotor(name, position) {
  if (!ROTOR_WIRINGS[name]) throw new Error('Unknown rotor "' + name + '"');
  const wiring = ROTOR_WIRINGS[name].wiring;
  return {
    name,
    wiring,
    inverse: buildInverse(wiring),
    notchIdx: charIndex(ROTOR_WIRINGS[name].notch),
    position: mod(position || 0, MOD)
  };
}

function rotorForward(inIdx, rotor) {
  return { in: inIdx, out: mod(charIndex(rotor.wiring[mod(inIdx + rotor.position, MOD)]) - rotor.position, MOD) };
}

function rotorBackward(inIdx, rotor) {
  return { in: inIdx, out: mod(rotor.inverse[mod(inIdx + rotor.position, MOD)] - rotor.position, MOD) };
}

function reflectorMap(inIdx, reflector) { return charIndex(REFLECTORS[reflector][inIdx]); }

/* Enigma-I double stepping. rotors = [left, middle, right]. */
function stepRotors(rotors) {
  const stepped = [false, false, false];
  const left = rotors[0], mid = rotors[1], right = rotors[2];
  if (mid.position === mid.notchIdx) {
    left.position = mod(left.position + 1, MOD);
    mid.position = mod(mid.position + 1, MOD);
    stepped[0] = stepped[1] = true;
  } else if (right.position === right.notchIdx) {
    mid.position = mod(mid.position + 1, MOD);
    stepped[1] = true;
  }
  right.position = mod(right.position + 1, MOD);
  stepped[2] = true;
  return stepped;
}

/* Plugboard: space-separated pairs such as "AB CD EF". */
function buildPlugboard(text) {
  if (text == null) return { letters: {}, pairs: [] };
  if (typeof text !== 'string' && text.letters && Array.isArray(text.pairs)) {
    return { letters: Object.assign({}, text.letters), pairs: text.pairs.slice() };
  }
  text = String(text).toUpperCase();
  if (text === '') return { letters: {}, pairs: [] };
  const parts = text.split(/[^A-Z]+/).filter(p => p.length > 0);
  const letters = {}, used = {}, pairs = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length !== 2) throw new Error('Plugboard pair "' + p + '" must contain exactly two letters.');
    if (p[0] === p[1]) throw new Error('Plugboard pair "' + p + '" cannot swap a letter with itself.');
    if (used[p[0]] || used[p[1]]) throw new Error('Plugboard letter reused in more than one pair: ' + p);
    used[p[0]] = used[p[1]] = true;
    letters[p[0]] = p[1]; letters[p[1]] = p[0];
    pairs.push(p);
  }
  if (pairs.length > 10) throw new Error('Plugboard supports at most 10 pairs of letters.');
  return { letters, pairs };
}

function plugboardMap(idx, pb) {
  if (!pb || !pb.letters) return idx;
  const ch = ALPHABET[idx];
  return pb.letters[ch] ? charIndex(pb.letters[ch]) : idx;
}

function normalizeConfiguration(configuration) {
  const cfg = configuration || {};
  if (!Array.isArray(cfg.rotors) || cfg.rotors.length !== 3) {
    throw new Error('Rotor configuration needs exactly three rotors.');
  }
  const out = {
    rotors: cfg.rotors.map(r => makeRotor(String(r.name), parseInt(r.position, 10))),
    reflector: String(cfg.reflector || 'B'),
    plugboard: buildPlugboard(cfg.plugboard)
  };
  if (!REFLECTORS[out.reflector]) throw new Error('Unknown reflector "' + out.reflector + '"');
  const names = out.rotors.map(r => r.name);
  if (names[0] === names[1] || names[1] === names[2] || names[0] === names[2]) {
    throw new Error('A rotor cannot be installed in more than one slot.');
  }
  return out;
}

function serializePlugboard(pb) { return pb && pb.pairs ? pb.pairs.join(' ') : ''; }
function snapshotRotors(rotors) { return rotors.map(r => ({ name: r.name, position: r.position })); }

/* ============================================================
   CAESAR PIPELINES
   encrypt:  C = (P + K) mod 26        decrypt:  P = (C - K) mod 26
   ============================================================ */
function runCaesar(input, k, mode, options) {
  const text = String(input == null ? '' : input);
  const trace = [], out = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const al = isAlpha(ch);
    const upper = al ? ch.toUpperCase() : ch;
    const idx = al ? charIndex(ch) : null;
    let outIdx = idx, outUp = upper, op = null, intermediate = null;
    if (al) {
      op = mode === 'encrypt' ? '+' + k : '-' + k;
      const raw = mode === 'encrypt' ? idx + k : idx - k;      // C = P + K | P = C - K
      intermediate = mod(raw, MOD);
      outIdx = intermediate;
      outUp = ALPHABET[outIdx];
    }
    const outCh = al ? (ch === ch.toUpperCase() ? outUp : outUp.toLowerCase()) : ch;
    out.push(outCh);
    trace.push({ position: i, char: ch, isAlpha: al, upper,
                 inputIndex: idx, operation: op, intermediate,
                 outputIndex: outIdx, outputLetter: outUp, output: outCh,
                 preserved: !al, mode });
  }
  return { input: text, output: out.join(''), mode, shift: k, trace,
           initialState: { shift: k, mode }, finalState: { shift: k, mode },
           metadata: { alphabetic: trace.filter(t => t.isAlpha).length, characters: trace.length } };
}

function caesarEncryptionPipeline(input, shift, options) {
  return runCaesar(input, normalizeShift(shift), 'encrypt', options || {});
}

function caesarDecryptionPipeline(input, shift, options) {
  return runCaesar(input, normalizeShift(shift), 'decrypt', options || {});
}

/* ============================================================
   ROTOR PIPELINES
   The machine is self-reciprocal: with identical settings and the
   same stepping sequence, encryption and decryption run the exact
   same electrical transformation.
   ============================================================ */
function runRotor(input, configuration, mode, options) {
  const cfg = normalizeConfiguration(configuration);
  const initialState = snapshotRotors(cfg.rotors);
  const text = String(input == null ? '' : input);
  const trace = [], out = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!isAlpha(ch)) {                       // not a letter: kept, rotors do not move
      trace.push({ position: i, char: ch, isAlpha: false, preserved: true, output: ch,
                   stepBefore: [cfg.rotors[0].position, cfg.rotors[1].position, cfg.rotors[2].position],
                   stepAfter: [cfg.rotors[0].position, cfg.rotors[1].position, cfg.rotors[2].position],
                   stepped: [false, false, false] });
      out.push(ch);
      continue;
    }

    const stepBefore = [cfg.rotors[0].position, cfg.rotors[1].position, cfg.rotors[2].position];
    const stepped = stepRotors(cfg.rotors);   // step before every letter (Enigma I)
    const stepAfter = [cfg.rotors[0].position, cfg.rotors[1].position, cfg.rotors[2].position];

    const isUp = ch === ch.toUpperCase();
    const idx = charIndex(ch);
    const plugOut = plugboardMap(idx, cfg.plugboard); // keyboard -> plugboard

    /* forward pass R -> M -> L */
    const forward = [];
    let res, x = plugOut;
    res = rotorForward(x, cfg.rotors[2]); forward.push({ slot: 'R', in: res.in, out: res.out }); x = res.out;
    res = rotorForward(x, cfg.rotors[1]); forward.push({ slot: 'M', in: res.in, out: res.out }); x = res.out;
    res = rotorForward(x, cfg.rotors[0]); forward.push({ slot: 'L', in: res.in, out: res.out }); x = res.out;

    const refIn = x;
    x = reflectorMap(x, cfg.reflector);       // reflector reverses the signal
    const refOut = x;

    /* return pass L -> M -> R */
    const reverse = [];
    res = rotorBackward(x, cfg.rotors[0]); reverse.push({ slot: 'L', in: res.in, out: res.out }); x = res.out;
    res = rotorBackward(x, cfg.rotors[1]); reverse.push({ slot: 'M', in: res.in, out: res.out }); x = res.out;
    res = rotorBackward(x, cfg.rotors[2]); reverse.push({ slot: 'R', in: res.in, out: res.out }); x = res.out;

    const outIdx = plugboardMap(x, cfg.plugboard); // plugboard -> lamp
    const outCh = isUp ? ALPHABET[outIdx] : ALPHABET[outIdx].toLowerCase();
    out.push(outCh);

    trace.push({
      position: i, char: ch, isAlpha: true, upper: ch.toUpperCase(), mode,
      stepBefore, stepAfter, stepped,
      plugIn: idx, plugOut,
      forward, reflector: { in: refIn, out: refOut }, reverse,
      plugFinalIn: reverse[2].out,
      outIndex: outIdx, outLetter: ALPHABET[outIdx], output: outCh
    });
  }

  return {
    input: text,
    output: out.join(''),
    mode,
    trace,
    metadata: { alphabetic: trace.filter(t => t.isAlpha).length, characters: trace.length },
    initialState: { rotors: initialState, reflector: cfg.reflector, plugboard: serializePlugboard(cfg.plugboard) },
    finalState: { rotors: snapshotRotors(cfg.rotors), reflector: cfg.reflector, plugboard: serializePlugboard(cfg.plugboard) },
    configuration: { rotors: snapshotRotors(cfg.rotors), reflector: cfg.reflector, plugboard: serializePlugboard(cfg.plugboard) }
  };
}

function rotorEncryptionPipeline(input, configuration, options) {
  return runRotor(input, configuration, 'encrypt', options || {});
}

function rotorDecryptionPipeline(input, configuration, options) {
  return runRotor(input, configuration, 'decrypt', options || {});
}
```

## Fidelity notes

- This is a **model** of the Enigma I mechanical behaviour, not a bit-for-bit clone. The most visible simplification
  is that stepping is resolved synchronously per character rather than emulating the physical ratchet-and-uvula
  movements.
- Ring settings (`Ringstellung`) are fixed at A, reflecting the most common classroom presentation; the "visible ring
  letter" therefore equals the rotor position.
- Rotors IV and V are included because the rotors were interchangeable; to restore the 1944 naval scenario, use
  I · II · III.
- Double stepping follows the classical rule "if the middle rotor sits on its notch it moves with the right rotor",
  which matches the widely referenced `BDZGO` test vector.

## Security notice

These are historical educational exhibits, remembered for their place in the history of cryptography. They provide
**no** modern security. The Caesar cipher has only 25 meaningful keys and the rotor machine here about a million
distinct internal configurations (60 rotor orders × 26³ positions, excluding the plugboard and reflector choices) —
far below any modern standard. Never use either to protect real data.

## Accessibility & design

- Keyboard operable: every trace row is focusable and reacts to Enter/Space.
- A `prefers-reduced-motion` media query and a manual **quiet mode** toggle (footer) switch the playback to
  instantaneous results.
- The braille-friendly `<svg>` readout text, `aria-live` region and labelled form controls are kept throughout.