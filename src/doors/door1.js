// ═══════════════════════════════════════════════════════════
// VIBE WARS - Intergalactic AI Trading Game
// (Inspired by TradeWars 2002 - classic BBS door game)
// Trade AI models, compute resources, and datasets across
// the galaxy while competing with other vibe coders.
// ═══════════════════════════════════════════════════════════
const ansi = require('../core/ansi');

const SECTORS = [
  { id: 1, name: 'Sol Station', desc: 'Home base - Earth orbit', danger: 0 },
  { id: 2, name: 'GPU Nebula', desc: 'Rich in compute resources', danger: 1 },
  { id: 3, name: 'Data Rim', desc: 'Massive dataset repositories', danger: 2 },
  { id: 4, name: 'Model Forge', desc: 'AI model trading hub', danger: 1 },
  { id: 5, name: 'Token Fields', desc: 'Token mining operations', danger: 3 },
  { id: 6, name: 'Prompt Bazaar', desc: 'Exotic prompt marketplace', danger: 2 },
  { id: 7, name: 'The Deep Stack', desc: 'Dangerous but profitable', danger: 4 },
  { id: 8, name: 'Inference Gate', desc: 'High-speed compute zone', danger: 3 },
];

const COMMODITIES = [
  { name: 'GPU Cores',     basePrice: 100, volatility: 30 },
  { name: 'Training Data',  basePrice: 50,  volatility: 20 },
  { name: 'Model Weights',  basePrice: 200, volatility: 50 },
  { name: 'API Tokens',     basePrice: 25,  volatility: 15 },
  { name: 'Prompt Packs',   basePrice: 75,  volatility: 25 },
  { name: 'VRAM Chips',     basePrice: 150, volatility: 40 },
];

class VibeWars {
  constructor(session) {
    this.session = session;
    this.player = {
      credits: 1000,
      sector: 1,
      cargo: {},
      cargoMax: 50,
      hull: 100,
      fuel: 20,
      turnsLeft: 30,
      score: 0,
    };
    // The current sector's market, rolled on arrival and held stable while the
    // caller stays in the sector.
    this.market = null;
    this.state = 'menu';
  }

  write(text) { this.session.write(text); }

  start() {
    this.showTitle();
  }

  showTitle() {
    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const m = ansi.brightMagenta;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;

    this.write(ansi.clear +
`${m}
    ██╗   ██╗██╗██████╗ ███████╗    ██╗    ██╗ █████╗ ██████╗ ███████╗
    ██║   ██║██║██╔══██╗██╔════╝    ██║    ██║██╔══██╗██╔══██╗██╔════╝
    ██║   ██║██║██████╔╝█████╗      ██║ █╗ ██║███████║██████╔╝███████╗
    ╚██╗ ██╔╝██║██╔══██╗██╔══╝      ██║███╗██║██╔══██║██╔══██╗╚════██║
     ╚████╔╝ ██║██████╔╝███████╗    ╚███╔███╔╝██║  ██║██║  ██║███████║
      ╚═══╝  ╚═╝╚═════╝ ╚══════╝     ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
${r}
${c}    ── Intergalactic AI Trading ──${r}

${y}    Trade AI resources across 8 sectors of the galaxy.
${y}    Buy low, sell high, avoid pirates, maximize profits!
${y}    You have ${w}30 turns${y} to build your fortune.${r}

${g}    Credits: ${w}${this.player.credits}   ${g}Fuel: ${w}${this.player.fuel}   ${g}Turns: ${w}${this.player.turnsLeft}${r}

`);
    this.showSector();
  }

  showSector() {
    this.state = 'sector';
    const sector = SECTORS[this.player.sector - 1];
    const prices = this.getPrices(this.player.sector);
    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    let screen =
`${d}    ┌──────────────────────────────────────────────────────┐
${d}    │ ${y}Sector ${sector.id}: ${w}${sector.name.padEnd(40)}${d}│
${d}    │ ${c}${sector.desc.padEnd(52)}${d}│
${d}    ├──────────────────────────────────────────────────────┤
${d}    │ ${g}Credits: ${w}${String(this.player.credits).padEnd(10)} ${g}Fuel: ${w}${String(this.player.fuel).padEnd(5)} ${g}Turns: ${w}${String(this.player.turnsLeft).padEnd(5)} ${d}│
${d}    │ ${g}Hull: ${w}${String(this.player.hull + '%').padEnd(10)} ${g}Cargo: ${w}${String(this.getCargoCount() + '/' + this.player.cargoMax).padEnd(10)}          ${d}│
${d}    ├──────────────────────────────────────────────────────┤
${d}    │ ${y}#   Commodity        Price    You Have               ${d}│\r\n`;

    for (let i = 0; i < COMMODITIES.length; i++) {
      const comm = COMMODITIES[i];
      const price = prices[i];
      const have = this.player.cargo[comm.name] || 0;
      screen += `${d}    │ ${y}${String(i + 1).padEnd(4)}${w}${comm.name.padEnd(17)}${c}${String(price).padStart(5)}cr  ${g}${String(have).padStart(5)}                ${d}│\r\n`;
    }

    screen +=
`${d}    ├──────────────────────────────────────────────────────┤
${d}    │ ${y}[${w}B${y}]${c}uy  ${y}[${w}S${y}]${c}ell  ${y}[${w}W${y}]${c}arp  ${y}[${w}M${y}]${c}ap  ${y}[${w}Q${y}]${c}uit Game    ${d}   │
${d}    └──────────────────────────────────────────────────────┘${r}
`;
    this.write(screen);
    this.session.prompt('Command: ');
  }

  // Prices are rolled once when the caller arrives in a sector, then held
  // stable for that visit so the displayed price is the price actually charged
  // and a caller can plan a trade. Volatility now comes from sector-to-sector
  // differences and from re-entering a sector later.
  getPrices(sectorId) {
    if (!this.market || this.market.sectorId !== sectorId) {
      this.market = { sectorId, prices: this.rollPrices(sectorId) };
    }
    return this.market.prices;
  }

  rollPrices(sectorId) {
    return COMMODITIES.map((comm, i) => {
      const sectorMod = ((sectorId * 37 + i * 13) % 60) - 30;
      const randomMod = Math.floor(Math.random() * comm.volatility) - comm.volatility / 2;
      return Math.max(10, Math.round(comm.basePrice + sectorMod + randomMod));
    });
  }

  getCargoCount() {
    return Object.values(this.player.cargo).reduce((a, b) => a + b, 0);
  }

  handleInput(input) {
    const cmd = (input || '').toUpperCase();

    switch (this.state) {
      case 'sector':
        this.handleSectorCommand(cmd);
        break;
      case 'buy':
        this.handleBuy(cmd);
        break;
      case 'buy_amount':
        this.handleBuyAmount(input);
        break;
      case 'sell':
        this.handleSell(cmd);
        break;
      case 'sell_amount':
        this.handleSellAmount(input);
        break;
      case 'warp':
        this.handleWarp(input);
        break;
      case 'gameover':
        this.session.exitDoor();
        break;
    }
  }

  handleSectorCommand(cmd) {
    switch (cmd) {
      case 'B':
        this.state = 'buy';
        this.session.prompt('Buy which commodity (1-6): ');
        break;
      case 'S':
        this.state = 'sell';
        this.session.prompt('Sell which commodity (1-6): ');
        break;
      case 'W':
        this.showMap();
        this.state = 'warp';
        this.session.prompt('Warp to sector (1-8): ');
        break;
      case 'M':
        this.showMap();
        this.session.prompt('Command: ');
        break;
      case 'Q':
        this.gameOver();
        break;
      default:
        this.session.prompt('Command: ');
    }
  }

  handleBuy(cmd) {
    const idx = parseInt(cmd) - 1;
    if (idx < 0 || idx >= COMMODITIES.length) {
      this.write(`${ansi.brightRed}    Invalid!${ansi.reset}\r\n`);
      this.state = 'sector';
      this.showSector();
      return;
    }
    this.stateData = { buyIdx: idx };
    const prices = this.getPrices(this.player.sector);
    const price = prices[idx];
    const maxAfford = Math.floor(this.player.credits / price);
    const maxCargo = this.player.cargoMax - this.getCargoCount();
    const max = Math.min(maxAfford, maxCargo);
    this.write(`${ansi.brightGreen}    ${COMMODITIES[idx].name} @ ${price}cr each. You can buy up to ${max}.${ansi.reset}\r\n`);
    this.state = 'buy_amount';
    this.session.prompt('Quantity: ');
  }

  handleBuyAmount(input) {
    const amount = parseInt(input);
    const idx = this.stateData.buyIdx;
    const prices = this.getPrices(this.player.sector);
    const price = prices[idx];
    const comm = COMMODITIES[idx];

    if (!amount || amount <= 0) {
      this.write(`${ansi.brightYellow}    Cancelled.${ansi.reset}\r\n`);
      this.state = 'sector';
      this.showSector();
      return;
    }

    const cost = amount * price;
    if (cost > this.player.credits) {
      this.write(`${ansi.brightRed}    Not enough credits!${ansi.reset}\r\n`);
      this.state = 'sector';
      this.showSector();
      return;
    }

    if (this.getCargoCount() + amount > this.player.cargoMax) {
      this.write(`${ansi.brightRed}    Not enough cargo space!${ansi.reset}\r\n`);
      this.state = 'sector';
      this.showSector();
      return;
    }

    this.player.credits -= cost;
    this.player.cargo[comm.name] = (this.player.cargo[comm.name] || 0) + amount;
    this.write(`${ansi.brightGreen}    Bought ${amount} ${comm.name} for ${cost}cr.${ansi.reset}\r\n`);
    this.state = 'sector';
    this.showSector();
  }

  handleSell(cmd) {
    const idx = parseInt(cmd) - 1;
    if (idx < 0 || idx >= COMMODITIES.length) {
      this.write(`${ansi.brightRed}    Invalid!${ansi.reset}\r\n`);
      this.state = 'sector';
      this.showSector();
      return;
    }
    const comm = COMMODITIES[idx];
    const have = this.player.cargo[comm.name] || 0;
    if (have === 0) {
      this.write(`${ansi.brightRed}    You don't have any ${comm.name}!${ansi.reset}\r\n`);
      this.state = 'sector';
      this.showSector();
      return;
    }
    this.stateData = { sellIdx: idx };
    const prices = this.getPrices(this.player.sector);
    this.write(`${ansi.brightGreen}    ${comm.name} @ ${prices[idx]}cr each. You have ${have}.${ansi.reset}\r\n`);
    this.state = 'sell_amount';
    this.session.prompt('Quantity (or ALL): ');
  }

  handleSellAmount(input) {
    const idx = this.stateData.sellIdx;
    const comm = COMMODITIES[idx];
    const have = this.player.cargo[comm.name] || 0;
    const prices = this.getPrices(this.player.sector);
    const price = prices[idx];

    let amount = input.toUpperCase() === 'ALL' ? have : parseInt(input);
    if (!amount || amount <= 0) {
      this.write(`${ansi.brightYellow}    Cancelled.${ansi.reset}\r\n`);
      this.state = 'sector';
      this.showSector();
      return;
    }
    if (amount > have) amount = have;

    const revenue = amount * price;
    this.player.credits += revenue;
    this.player.cargo[comm.name] -= amount;
    if (this.player.cargo[comm.name] <= 0) delete this.player.cargo[comm.name];

    this.write(`${ansi.brightGreen}    Sold ${amount} ${comm.name} for ${revenue}cr.${ansi.reset}\r\n`);
    this.state = 'sector';
    this.showSector();
  }

  handleWarp(input) {
    const dest = parseInt(input);
    if (!dest || dest < 1 || dest > 8 || dest === this.player.sector) {
      this.write(`${ansi.brightRed}    Invalid sector!${ansi.reset}\r\n`);
      this.state = 'sector';
      this.showSector();
      return;
    }

    const fuelCost = Math.abs(dest - this.player.sector);
    if (fuelCost > this.player.fuel) {
      this.write(`${ansi.brightRed}    Not enough fuel! Need ${fuelCost}, have ${this.player.fuel}.${ansi.reset}\r\n`);
      this.state = 'sector';
      this.showSector();
      return;
    }

    this.player.fuel -= fuelCost;
    this.player.turnsLeft--;
    this.player.sector = dest;

    // Random encounter based on danger level
    const sector = SECTORS[dest - 1];
    if (Math.random() < sector.danger * 0.15) {
      this.pirateEncounter();
    } else {
      this.write(`${ansi.brightCyan}    Warping to ${sector.name}...${ansi.reset}\r\n`);
      if (this.player.turnsLeft <= 0) {
        this.gameOver();
      } else {
        this.showSector();
      }
    }
  }

  pirateEncounter() {
    const damage = Math.floor(Math.random() * 20) + 5;
    const stolen = Math.floor(this.player.credits * 0.1);

    this.write(`\r\n${ansi.brightRed}    ⚠ PIRATE ATTACK! ⚠${ansi.reset}\r\n`);
    this.write(`${ansi.brightRed}    Rogue AI pirates intercept your ship!${ansi.reset}\r\n`);
    this.write(`${ansi.brightRed}    Hull damage: -${damage}%   Credits stolen: ${stolen}cr${ansi.reset}\r\n\r\n`);

    this.player.hull -= damage;
    this.player.credits -= stolen;
    if (this.player.credits < 0) this.player.credits = 0;

    if (this.player.hull <= 0) {
      this.write(`${ansi.brightRed}    Your ship has been destroyed!${ansi.reset}\r\n`);
      this.gameOver();
    } else {
      this.showSector();
    }
  }

  showMap() {
    const r = ansi.reset;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const c = ansi.brightCyan;
    const g = ansi.brightGreen;

    let map = `\r\n${c}    ── Galaxy Map ──${r}\r\n\r\n`;
    for (const sector of SECTORS) {
      const marker = sector.id === this.player.sector ? `${g}>>` : '  ';
      const danger = '!'.repeat(sector.danger) || '-';
      map += `    ${marker} ${y}${String(sector.id).padEnd(3)}${w}${sector.name.padEnd(18)} ${c}${sector.desc.padEnd(30)} ${ansi.brightRed}[${danger}]${r}\r\n`;
    }
    map += '\r\n';
    this.write(map);
  }

  gameOver() {
    this.state = 'gameover';
    // Calculate score
    let cargoValue = 0;
    for (const [name, qty] of Object.entries(this.player.cargo)) {
      const comm = COMMODITIES.find(c => c.name === name);
      if (comm) cargoValue += comm.basePrice * qty;
    }
    const totalScore = this.player.credits + cargoValue;

    this.write(`\r\n${ansi.brightYellow}    ═══════════════════════════════════════${ansi.reset}\r\n`);
    this.write(`${ansi.brightWhite}              GAME OVER${ansi.reset}\r\n`);
    this.write(`${ansi.brightYellow}    ═══════════════════════════════════════${ansi.reset}\r\n\r\n`);
    this.write(`${ansi.brightGreen}    Final Credits:  ${ansi.brightWhite}${this.player.credits}cr${ansi.reset}\r\n`);
    this.write(`${ansi.brightGreen}    Cargo Value:    ${ansi.brightWhite}${cargoValue}cr${ansi.reset}\r\n`);
    this.write(`${ansi.brightGreen}    Hull Remaining: ${ansi.brightWhite}${this.player.hull}%${ansi.reset}\r\n`);
    this.write(`${ansi.brightCyan}    ───────────────────────────────────────${ansi.reset}\r\n`);
    this.write(`${ansi.brightYellow}    TOTAL SCORE:    ${ansi.brightWhite}${totalScore}${ansi.reset}\r\n\r\n`);
    this.write(`${ansi.pausePrompt}\r\n`);
  }
}

module.exports = VibeWars;
