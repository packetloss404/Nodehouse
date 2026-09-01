// ═══════════════════════════════════════════════════════════
// STACK OVERFLOW - Developer Hangman
// (Classic Hangman with a dev twist for The Nodehouse)
// Guess programming terms, framework names, and dev jargon
// before your stack overflows!
// ═══════════════════════════════════════════════════════════
const ansi = require('../core/ansi');

const WORD_LISTS = {
  'Programming Languages': [
    'JAVASCRIPT', 'TYPESCRIPT', 'PYTHON', 'RUST', 'GOLANG',
    'RUBY', 'SWIFT', 'KOTLIN', 'HASKELL', 'ELIXIR',
    'CLOJURE', 'SCALA', 'ERLANG', 'FORTRAN', 'COBOL',
    'ASSEMBLY', 'PERL', 'JULIA', 'DART', 'ZIG',
  ],
  'Frameworks & Tools': [
    'REACT', 'NEXTJS', 'DJANGO', 'FLASK', 'RAILS',
    'SPRING', 'EXPRESS', 'FASTAPI', 'SVELTE', 'ANGULAR',
    'DOCKER', 'KUBERNETES', 'TERRAFORM', 'WEBPACK', 'VITE',
    'GATSBY', 'REMIX', 'ASTRO', 'NUXT', 'LARAVEL',
  ],
  'Dev Concepts': [
    'RECURSION', 'MIDDLEWARE', 'REFACTOR', 'SINGLETON',
    'MICROSERVICE', 'MONOREPO', 'DEVOPS', 'PIPELINE',
    'DEPLOYMENT', 'ROLLBACK', 'HOTFIX', 'SERVERLESS',
    'IDEMPOTENT', 'WEBHOOK', 'THROTTLE', 'DEBOUNCE',
    'IMMUTABLE', 'POLYMORPHISM', 'ABSTRACTION', 'ENCAPSULATION',
  ],
  'AI & Vibe Coding': [
    'TRANSFORMER', 'ATTENTION', 'EMBEDDING', 'TOKENIZER',
    'INFERENCE', 'FINETUNING', 'HALLUCINATION', 'PROMPT',
    'CLAUDE', 'COPILOT', 'DIFFUSION', 'REINFORCEMENT',
    'BENCHMARK', 'QUANTIZATION', 'RETRIEVAL', 'CONTEXT',
    'TEMPERATURE', 'ALIGNMENT', 'GRADIENT', 'BACKPROPAGATION',
  ],
};

const STACK_ART = [
  // 0 wrong
  `
      ┌──────────┐
      │          │
      │          │
      │          │
      │          │
      │          │
    ──┴──────────┴──`,
  // 1 wrong
  `
      ┌──────────┐
      │          │
      │   ┌──┐   │
      │   │  │   │
      │   └──┘   │
      │          │
    ──┴──────────┴──`,
  // 2 wrong
  `
      ┌──────────┐
      │          │
      │   ┌──┐   │
      │   │  │   │
      │   └──┘   │
      │    ██    │
    ──┴──────────┴──`,
  // 3 wrong
  `
      ┌──────────┐
      │          │
      │   ┌──┐   │
      │   │  │   │
      │   └──┘   │
      │   ███    │
    ──┴──────────┴──`,
  // 4 wrong
  `
      ┌──────────┐
      │          │
      │   ┌──┐   │
      │   │  │   │
      │   └──┘   │
      │   ████   │
    ──┴──────────┴──`,
  // 5 wrong
  `
      ┌──────────┐
      │  STACK   │
      │   ┌──┐   │
      │   │XX│   │
      │   └──┘   │
      │  █████   │
    ──┴──────────┴──`,
  // 6 wrong - GAME OVER
  `
      ┌──────────┐
      │  STACK   │
      │ OVERFLOW │
      │   ┌──┐   │
      │   │XX│   │
      │   └──┘   │
      │  ██████  │
    ──┴──────────┴──`,
];

class StackOverflow {
  constructor(session) {
    this.session = session;
    this.state = 'title';
    this.word = '';
    this.category = '';
    this.guessed = new Set();
    this.wrong = 0;
    this.maxWrong = 6;
    this.score = 0;
    this.round = 0;
    this.wins = 0;
    this.losses = 0;
  }

  write(text) { this.session.write(text); }

  start() {
    this.showTitle();
  }

  showTitle() {
    const r = ansi.reset;
    const y = ansi.brightYellow;
    const c = ansi.brightCyan;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const m = ansi.brightMagenta;

    this.write(ansi.clear +
`${y}
     ██████╗████████╗ █████╗  ██████╗██╗  ██╗
    ██╔════╝╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝
    ╚█████╗    ██║   ███████║██║     █████═╝
     ╚═══██╗   ██║   ██╔══██║██║     ██╔═██╗
    ██████╔╝   ██║   ██║  ██║╚██████╗██║ ╚██╗
    ╚═════╝    ╚═╝   ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝
${m}     ██████╗ ██╗   ██╗███████╗██████╗ ███████╗██╗      ██████╗ ██╗    ██╗
    ██╔═══██╗██║   ██║██╔════╝██╔══██╗██╔════╝██║     ██╔═══██╗██║    ██║
    ██║   ██║██║   ██║█████╗  ██████╔╝█████╗  ██║     ██║   ██║██║ █╗ ██║
    ██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██╔══╝  ██║     ██║   ██║██║███╗██║
    ╚██████╔╝ ╚████╔╝ ███████╗██║  ██║██║     ███████╗╚██████╔╝╚███╔███╔╝
     ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝  ╚══╝╚══╝${r}

${c}    Guess the programming term before your stack overflows!
${c}    Categories: Languages, Frameworks, Concepts, AI & Vibe Coding${r}

`);
    this.nextWord();
  }

  nextWord() {
    this.round++;
    this.guessed = new Set();
    this.wrong = 0;

    // Pick random category and word
    const categories = Object.keys(WORD_LISTS);
    this.category = categories[Math.floor(Math.random() * categories.length)];
    const words = WORD_LISTS[this.category];
    this.word = words[Math.floor(Math.random() * words.length)];

    this.state = 'playing';
    this.showBoard();
  }

  showBoard() {
    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const m = ansi.brightMagenta;
    const d = ansi.cyan;
    const red = ansi.brightRed;

    // Build display word
    let display = '';
    for (const ch of this.word) {
      if (ch === ' ') {
        display += '  ';
      } else if (this.guessed.has(ch)) {
        display += `${g}${ch} `;
      } else {
        display += `${c}_ `;
      }
    }

    // Build used letters
    const used = [...this.guessed].sort().join(' ');
    const wrongLetters = [...this.guessed].filter(l => !this.word.includes(l)).join(' ');

    this.write(ansi.clear);
    this.write(`${y}    Round ${this.round}   ${g}Wins: ${this.wins}   ${red}Losses: ${this.losses}   ${c}Score: ${this.score}${r}\r\n`);
    this.write(`${d}    Category: ${w}${this.category}${r}\r\n\r\n`);

    // Stack art
    const art = STACK_ART[Math.min(this.wrong, STACK_ART.length - 1)];
    const artLines = art.split('\n');
    for (const line of artLines) {
      this.write(`${red}    ${line}${r}\r\n`);
    }

    this.write(`\r\n${c}    Word: ${display}${r}\r\n\r\n`);

    if (wrongLetters) {
      this.write(`${red}    Wrong: ${wrongLetters}${r}\r\n`);
    }
    this.write(`${d}    Guesses left: ${w}${this.maxWrong - this.wrong}${r}\r\n\r\n`);

    this.session.prompt('Guess a letter: ');
  }

  handleInput(input) {
    switch (this.state) {
      case 'playing':
        this.handleGuess(input);
        break;
      case 'roundover':
        this.handleRoundOver(input);
        break;
      case 'gameover':
        this.session.exitDoor();
        break;
    }
  }

  handleGuess(input) {
    if (!input) {
      this.session.prompt('Guess a letter: ');
      return;
    }

    const letter = input.toUpperCase()[0];

    if (!/[A-Z]/.test(letter)) {
      this.write(`${ansi.brightRed}    Letters only!${ansi.reset}\r\n`);
      this.session.prompt('Guess a letter: ');
      return;
    }

    if (this.guessed.has(letter)) {
      this.write(`${ansi.brightYellow}    Already guessed '${letter}'!${ansi.reset}\r\n`);
      this.session.prompt('Guess a letter: ');
      return;
    }

    this.guessed.add(letter);

    if (this.word.includes(letter)) {
      // Count how many this reveals
      const count = [...this.word].filter(c => c === letter).length;
      this.score += count * 10;
      this.write(`${ansi.brightGreen}    ✓ '${letter}' is in the word! (+${count * 10} pts)${ansi.reset}\r\n`);

      // Check win
      if (this.isWordGuessed()) {
        this.wins++;
        this.score += 50; // Bonus for completing word
        this.write(`\r\n${ansi.brightGreen}    ★★★ CORRECT! The word was: ${this.word} ★★★${ansi.reset}\r\n`);
        this.write(`${ansi.brightYellow}    +50 bonus points!${ansi.reset}\r\n\r\n`);
        this.state = 'roundover';
        this.write(`${ansi.brightCyan}    [${ansi.brightWhite}N${ansi.brightCyan}]ext word  [${ansi.brightWhite}Q${ansi.brightCyan}]uit${ansi.reset}\r\n`);
        this.session.prompt('Choice: ');
        return;
      }
    } else {
      this.wrong++;
      this.write(`${ansi.brightRed}    ✗ '${letter}' is not in the word!${ansi.reset}\r\n`);

      if (this.wrong >= this.maxWrong) {
        this.losses++;
        this.write(`\r\n${ansi.brightRed}    ╔═══════════════════════════════╗${ansi.reset}\r\n`);
        this.write(`${ansi.brightRed}    ║   STACK OVERFLOW! CRASHED!   ║${ansi.reset}\r\n`);
        this.write(`${ansi.brightRed}    ╚═══════════════════════════════╝${ansi.reset}\r\n`);
        this.write(`${ansi.brightYellow}    The word was: ${ansi.brightWhite}${this.word}${ansi.reset}\r\n\r\n`);
        this.state = 'roundover';
        this.write(`${ansi.brightCyan}    [${ansi.brightWhite}N${ansi.brightCyan}]ext word  [${ansi.brightWhite}Q${ansi.brightCyan}]uit${ansi.reset}\r\n`);
        this.session.prompt('Choice: ');
        return;
      }
    }

    this.showBoard();
  }

  handleRoundOver(input) {
    const cmd = (input || '').toUpperCase();
    if (cmd === 'N') {
      this.nextWord();
    } else {
      this.showFinalScore();
    }
  }

  isWordGuessed() {
    return [...this.word].every(ch => ch === ' ' || this.guessed.has(ch));
  }

  showFinalScore() {
    this.state = 'gameover';
    const r = ansi.reset;

    this.write(`\r\n${ansi.brightYellow}    ═══════════════════════════════════════${r}\r\n`);
    this.write(`${ansi.brightWhite}           STACK OVERFLOW - FINAL SCORE${r}\r\n`);
    this.write(`${ansi.brightYellow}    ═══════════════════════════════════════${r}\r\n\r\n`);
    this.write(`${ansi.brightCyan}    Rounds Played: ${ansi.brightWhite}${this.round}${r}\r\n`);
    this.write(`${ansi.brightGreen}    Wins:          ${ansi.brightWhite}${this.wins}${r}\r\n`);
    this.write(`${ansi.brightRed}    Losses:        ${ansi.brightWhite}${this.losses}${r}\r\n`);
    this.write(`${ansi.brightYellow}    Win Rate:      ${ansi.brightWhite}${this.round > 0 ? Math.round(this.wins / this.round * 100) : 0}%${r}\r\n`);
    this.write(`${ansi.brightMagenta}    Total Score:   ${ansi.brightWhite}${this.score}${r}\r\n\r\n`);

    if (this.score > 500) {
      this.write(`${ansi.brightGreen}    10x Developer status achieved!${r}\r\n`);
    } else if (this.score > 200) {
      this.write(`${ansi.brightYellow}    Solid debugging skills!${r}\r\n`);
    } else {
      this.write(`${ansi.brightCyan}    Keep coding and try again!${r}\r\n`);
    }

    this.write(`\r\n${ansi.pausePrompt}\r\n`);
  }
}

module.exports = StackOverflow;
