// ═══════════════════════════════════════════════════════════
// TOKEN TYCOON - Build Your AI Empire
// (Original game for The Nodehouse)
// A turn-based strategy game where you build and manage
// an AI startup. Hire engineers, train models, serve
// customers, and compete for market dominance.
// ═══════════════════════════════════════════════════════════
const ansi = require('../core/ansi');

const EVENTS = [
  { text: 'A viral tweet brings attention to your startup!', effect: { reputation: 10, customers: 5 } },
  { text: 'Your model hallucinates on live TV...', effect: { reputation: -15, customers: -3 } },
  { text: 'You win a benchmarking contest!', effect: { reputation: 20, customers: 8 } },
  { text: 'AWS bill comes in higher than expected.', effect: { money: -500 } },
  { text: 'An angel investor drops by!', effect: { money: 2000 } },
  { text: 'Your best engineer quits for a competitor.', effect: { engineers: -1 } },
  { text: 'Open-source community contributes a PR!', effect: { modelQuality: 5 } },
  { text: 'GPU prices drop! Compute costs reduced.', effect: { money: 300 } },
  { text: 'A competitor launches a rival product.', effect: { customers: -4, reputation: -5 } },
  { text: 'Your API hits 99.99% uptime this month!', effect: { reputation: 10, customers: 3 } },
  { text: 'NVIDIA sends you free H100s!', effect: { computePower: 20 } },
  { text: 'Your model passes the vibe check with flying colors!', effect: { modelQuality: 10, reputation: 5 } },
];

class TokenTycoon {
  constructor(session) {
    this.session = session;
    this.state = 'menu';
    this.turn = 1;
    this.maxTurns = 24; // 24 "months"
    this.company = {
      name: `${session.user.username}'s AI Co`,
      money: 5000,
      engineers: 2,
      computePower: 10,
      modelQuality: 10,
      customers: 0,
      reputation: 20,
      monthlyRevenue: 0,
      monthlyCost: 0,
      modelsTraining: 0,
    };
  }

  write(text) { this.session.write(text); }

  start() {
    this.showTitle();
  }

  showTitle() {
    const r = ansi.reset;
    const y = ansi.brightYellow;
    const g = ansi.brightGreen;
    const c = ansi.brightCyan;
    const w = ansi.brightWhite;
    const m = ansi.brightMagenta;

    this.write(ansi.clear +
`${y}
    ████████╗ ██████╗ ██╗  ██╗███████╗███╗   ██╗
    ╚══██╔══╝██╔═══██╗██║ ██╔╝██╔════╝████╗  ██║
       ██║   ██║   ██║█████╔╝ █████╗  ██╔██╗ ██║
       ██║   ██║   ██║██╔═██╗ ██╔══╝  ██║╚██╗██║
       ██║   ╚██████╔╝██║  ██╗███████╗██║ ╚████║
       ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝
${m}              ████████╗██╗   ██╗ ██████╗ ██████╗  ██████╗ ███╗   ██╗
              ╚══██╔══╝╚██╗ ██╔╝██╔════╝██╔═══██╗██╔═══██╗████╗  ██║
                 ██║    ╚████╔╝ ██║     ██║   ██║██║   ██║██╔██╗ ██║
                 ██║     ╚██╔╝  ██║     ██║   ██║██║   ██║██║╚██╗██║
                 ██║      ██║   ╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║
                 ╚═╝      ╚═╝    ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝${r}

${c}    Build your AI startup from zero to IPO in 24 months!
${c}    Hire talent, train models, win customers, dominate the market.${r}

`);
    this.showDashboard();
  }

  showDashboard() {
    this.state = 'menu';
    const co = this.company;
    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const m = ansi.brightMagenta;
    const d = ansi.cyan;

    // Calculate finances
    co.monthlyRevenue = co.customers * Math.floor(co.modelQuality * 0.8);
    co.monthlyCost = co.engineers * 200 + Math.floor(co.computePower * 5);

    let screen = ansi.clear +
`${d}    ┌──────────────────────────────────────────────────────┐
${d}    │ ${w}${co.name.padEnd(30)} ${y}Month ${String(this.turn).padStart(2)}/${this.maxTurns}        ${d}│
${d}    ├──────────────────────────────────────────────────────┤
${d}    │  ${g}Cash:        ${w}$${String(co.money).padEnd(12)} ${g}Revenue: ${w}$${String(co.monthlyRevenue).padEnd(8)} ${d}│
${d}    │  ${g}Engineers:   ${w}${String(co.engineers).padEnd(12)} ${g}Costs:   ${w}$${String(co.monthlyCost).padEnd(8)} ${d}│
${d}    │  ${g}Compute:     ${w}${String(co.computePower).padEnd(12)} ${g}Profit:  ${w}$${String(co.monthlyRevenue - co.monthlyCost).padEnd(8)} ${d}│
${d}    │  ${c}Model Qual:  ${w}${String(co.modelQuality).padEnd(12)} ${y}Rep:     ${w}${String(co.reputation).padEnd(8)}  ${d}│
${d}    │  ${c}Customers:   ${w}${String(co.customers).padEnd(12)}                          ${d}│
${d}    ├──────────────────────────────────────────────────────┤
${d}    │                                                      │
${d}    │  ${y}[${w}1${y}]${c} Hire Engineers     ($500/ea, $200/mo)            ${d}│
${d}    │  ${y}[${w}2${y}]${c} Buy Compute        ($300 per 10 units)           ${d}│
${d}    │  ${y}[${w}3${y}]${c} Train Model        (needs eng + compute)         ${d}│
${d}    │  ${y}[${w}4${y}]${c} Marketing Push     ($200, boosts reputation)     ${d}│
${d}    │  ${y}[${w}5${y}]${c} Acquire Customers  (costs rep, gains revenue)    ${d}│
${d}    │  ${y}[${w}6${y}]${c} Research (R&D)     (invest in future quality)    ${d}│
${d}    │  ${y}[${w}N${y}]${c} Next Month         (advance to next turn)        ${d}│
${d}    │  ${y}[${w}Q${y}]${c} Quit Game                                        ${d}│
${d}    │                                                      │
${d}    └──────────────────────────────────────────────────────┘${r}
`;
    this.write(screen);
    this.session.prompt('Action: ');
  }

  handleInput(input) {
    const cmd = (input || '').toUpperCase();

    switch (this.state) {
      case 'menu':
        this.handleMenu(cmd);
        break;
      case 'hire':
        this.handleHire(input);
        break;
      case 'compute':
        this.handleCompute(input);
        break;
      case 'gameover':
        this.session.exitDoor();
        break;
    }
  }

  handleMenu(cmd) {
    const co = this.company;

    switch (cmd) {
      case '1': // Hire
        this.state = 'hire';
        this.write(`${ansi.brightCyan}    Each engineer costs $500 to hire, $200/mo salary.${ansi.reset}\r\n`);
        this.session.prompt('How many to hire: ');
        break;
      case '2': // Compute
        this.state = 'compute';
        this.write(`${ansi.brightCyan}    $300 per 10 compute units.${ansi.reset}\r\n`);
        this.session.prompt('How many batches (10 units each): ');
        break;
      case '3': // Train
        if (co.engineers < 1) {
          this.write(`${ansi.brightRed}    Need at least 1 engineer!${ansi.reset}\r\n`);
        } else if (co.computePower < 5) {
          this.write(`${ansi.brightRed}    Need at least 5 compute power!${ansi.reset}\r\n`);
        } else {
          const qualGain = Math.floor(co.engineers * 3 + co.computePower * 0.5);
          co.computePower = Math.max(0, co.computePower - 5);
          co.modelQuality += qualGain;
          this.write(`${ansi.brightGreen}    Model trained! Quality +${qualGain} (now ${co.modelQuality})${ansi.reset}\r\n`);
          this.write(`${ansi.brightYellow}    Used 5 compute power.${ansi.reset}\r\n`);
        }
        this.showDashboard();
        break;
      case '4': // Marketing
        if (co.money < 200) {
          this.write(`${ansi.brightRed}    Not enough cash!${ansi.reset}\r\n`);
        } else {
          co.money -= 200;
          const repGain = Math.floor(Math.random() * 10) + 5;
          co.reputation += repGain;
          this.write(`${ansi.brightGreen}    Marketing push! Reputation +${repGain}${ansi.reset}\r\n`);
        }
        this.showDashboard();
        break;
      case '5': // Acquire customers
        if (co.reputation < 10) {
          this.write(`${ansi.brightRed}    Reputation too low! Need at least 10.${ansi.reset}\r\n`);
        } else {
          const gained = Math.floor(co.reputation / 5) + Math.floor(co.modelQuality / 10);
          co.customers += gained;
          co.reputation = Math.max(0, co.reputation - 5);
          this.write(`${ansi.brightGreen}    Acquired ${gained} new customers!${ansi.reset}\r\n`);
        }
        this.showDashboard();
        break;
      case '6': // R&D
        if (co.money < 400) {
          this.write(`${ansi.brightRed}    Need $400 for R&D!${ansi.reset}\r\n`);
        } else {
          co.money -= 400;
          const qualGain = Math.floor(Math.random() * 8) + 3;
          co.modelQuality += qualGain;
          this.write(`${ansi.brightGreen}    R&D complete! Model quality +${qualGain}${ansi.reset}\r\n`);
        }
        this.showDashboard();
        break;
      case 'N': // Next month
        this.advanceMonth();
        break;
      case 'Q':
        this.gameOver();
        break;
      default:
        this.session.prompt('Action: ');
    }
  }

  handleHire(input) {
    const count = parseInt(input) || 0;
    if (count > 0) {
      const cost = count * 500;
      if (cost > this.company.money) {
        this.write(`${ansi.brightRed}    Not enough cash!${ansi.reset}\r\n`);
      } else {
        this.company.money -= cost;
        this.company.engineers += count;
        this.write(`${ansi.brightGreen}    Hired ${count} engineer(s)! -$${cost}${ansi.reset}\r\n`);
      }
    }
    this.showDashboard();
  }

  handleCompute(input) {
    const batches = parseInt(input) || 0;
    if (batches > 0) {
      const cost = batches * 300;
      if (cost > this.company.money) {
        this.write(`${ansi.brightRed}    Not enough cash!${ansi.reset}\r\n`);
      } else {
        this.company.money -= cost;
        this.company.computePower += batches * 10;
        this.write(`${ansi.brightGreen}    Bought ${batches * 10} compute units! -$${cost}${ansi.reset}\r\n`);
      }
    }
    this.showDashboard();
  }

  advanceMonth() {
    const co = this.company;

    // Apply revenue and costs
    co.money += co.monthlyRevenue - co.monthlyCost;

    // Random event
    if (Math.random() < 0.6) {
      const event = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      this.write(`\r\n${ansi.brightYellow}    ★ NEWS: ${event.text}${ansi.reset}\r\n`);

      for (const [key, val] of Object.entries(event.effect)) {
        co[key] = Math.max(0, (co[key] || 0) + val);
      }
    }

    // Customer churn
    if (co.modelQuality < 20 && co.customers > 0) {
      const churn = Math.floor(co.customers * 0.1);
      if (churn > 0) {
        co.customers -= churn;
        this.write(`${ansi.brightRed}    ${churn} customer(s) churned due to low model quality!${ansi.reset}\r\n`);
      }
    }

    // Organic growth
    if (co.reputation > 30 && co.modelQuality > 30) {
      const organic = Math.floor(Math.random() * 3) + 1;
      co.customers += organic;
      this.write(`${ansi.brightGreen}    +${organic} organic customer(s) from word-of-mouth!${ansi.reset}\r\n`);
    }

    this.turn++;

    if (co.money < 0) {
      this.write(`\r\n${ansi.brightRed}    *** BANKRUPT! Your startup has run out of money! ***${ansi.reset}\r\n`);
      this.gameOver();
      return;
    }

    if (this.turn > this.maxTurns) {
      this.gameOver();
      return;
    }

    this.showDashboard();
  }

  gameOver() {
    this.state = 'gameover';
    const co = this.company;
    const r = ansi.reset;

    // Calculate valuation
    const valuation = co.money + (co.customers * co.modelQuality * 10) + (co.reputation * 100) + (co.engineers * 1000);

    let grade = 'F';
    if (valuation > 100000) grade = 'S';
    else if (valuation > 50000) grade = 'A';
    else if (valuation > 25000) grade = 'B';
    else if (valuation > 10000) grade = 'C';
    else if (valuation > 5000) grade = 'D';

    this.write(`\r\n${ansi.brightYellow}    ═══════════════════════════════════════${r}\r\n`);
    this.write(`${ansi.brightWhite}           TOKEN TYCOON - FINAL RESULTS${r}\r\n`);
    this.write(`${ansi.brightYellow}    ═══════════════════════════════════════${r}\r\n\r\n`);
    this.write(`${ansi.brightCyan}    Company:     ${ansi.brightWhite}${co.name}${r}\r\n`);
    this.write(`${ansi.brightCyan}    Months:      ${ansi.brightWhite}${Math.min(this.turn, this.maxTurns)}${r}\r\n`);
    this.write(`${ansi.brightCyan}    Cash:        ${ansi.brightWhite}$${co.money}${r}\r\n`);
    this.write(`${ansi.brightCyan}    Customers:   ${ansi.brightWhite}${co.customers}${r}\r\n`);
    this.write(`${ansi.brightCyan}    Model Qual:  ${ansi.brightWhite}${co.modelQuality}${r}\r\n`);
    this.write(`${ansi.brightCyan}    Reputation:  ${ansi.brightWhite}${co.reputation}${r}\r\n`);
    this.write(`${ansi.brightCyan}    Engineers:   ${ansi.brightWhite}${co.engineers}${r}\r\n`);
    this.write(`${ansi.brightYellow}    ───────────────────────────────────────${r}\r\n`);
    this.write(`${ansi.brightMagenta}    Valuation:   ${ansi.brightWhite}$${valuation.toLocaleString()}${r}\r\n`);
    this.write(`${ansi.brightMagenta}    Grade:       ${ansi.brightWhite}${grade}${r}\r\n\r\n`);

    if (grade === 'S') {
      this.write(`${ansi.brightGreen}    IPO SUCCESS! You're the next big AI company!${r}\r\n`);
    } else if (grade === 'A') {
      this.write(`${ansi.brightGreen}    Unicorn status achieved! VCs are calling!${r}\r\n`);
    } else if (grade === 'B') {
      this.write(`${ansi.brightYellow}    Solid startup! You're making waves.${r}\r\n`);
    } else {
      this.write(`${ansi.brightRed}    Maybe pivot to consulting...${r}\r\n`);
    }

    this.write(`\r\n${ansi.pausePrompt}\r\n`);
  }
}

module.exports = TokenTycoon;
