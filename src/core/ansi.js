// ANSI escape code utilities and art for The Nodehouse

const { version } = require('../../package.json');

const ESC = '\x1b';
const CSI = `${ESC}[`;

const ansi = {
  // Screen control
  clear: `${CSI}2J${CSI}1;1H`,
  home: `${CSI}1;1H`,
  saveCursor: `${CSI}s`,
  restoreCursor: `${CSI}u`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,

  // Cursor movement
  up: (n = 1) => `${CSI}${n}A`,
  down: (n = 1) => `${CSI}${n}B`,
  right: (n = 1) => `${CSI}${n}C`,
  left: (n = 1) => `${CSI}${n}D`,
  goto: (row, col) => `${CSI}${row};${col}H`,
  eraseLine: `${CSI}2K`,

  // Colors
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  blink: `${CSI}5m`,
  reverse: `${CSI}7m`,

  // Foreground colors
  black: `${CSI}30m`,
  red: `${CSI}31m`,
  green: `${CSI}32m`,
  yellow: `${CSI}33m`,
  blue: `${CSI}34m`,
  magenta: `${CSI}35m`,
  cyan: `${CSI}36m`,
  white: `${CSI}37m`,

  // Bright foreground
  brightBlack: `${CSI}90m`,
  brightRed: `${CSI}91m`,
  brightGreen: `${CSI}92m`,
  brightYellow: `${CSI}93m`,
  brightBlue: `${CSI}94m`,
  brightMagenta: `${CSI}95m`,
  brightCyan: `${CSI}96m`,
  brightWhite: `${CSI}97m`,

  // Background colors
  bgBlack: `${CSI}40m`,
  bgRed: `${CSI}41m`,
  bgBlue: `${CSI}44m`,
  bgCyan: `${CSI}46m`,
  bgWhite: `${CSI}47m`,

  // Helpers
  color: (fg, bg) => {
    let code = `${CSI}${fg}`;
    if (bg !== undefined) code += `;${bg}`;
    return code + 'm';
  },

  // Draw a horizontal line
  hline: (width, char = '─') => char.repeat(width),

  // Draw a box
  box: (width, height, title = '') => {
    let result = '┌';
    if (title) {
      result += '┤ ' + title + ' ├';
      result += '─'.repeat(Math.max(0, width - title.length - 6));
    } else {
      result += '─'.repeat(width - 2);
    }
    result += '┐\r\n';
    for (let i = 0; i < height - 2; i++) {
      result += '│' + ' '.repeat(width - 2) + '│\r\n';
    }
    result += '└' + '─'.repeat(width - 2) + '┘\r\n';
    return result;
  },

  // Center text in a given width
  center: (text, width) => {
    const stripped = ansi.stripCodes(text);
    const pad = Math.max(0, Math.floor((width - stripped.length) / 2));
    return ' '.repeat(pad) + text;
  },

  // Strip ANSI codes from text (for length calculations)
  stripCodes: (text) => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''),

  // Wrap plain caller-authored text without exceeding a terminal column.
  wrapText: (text, width = 52) => {
    const wrapped = [];
    const sourceLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    for (const sourceLine of sourceLines) {
      let remaining = sourceLine;
      if (!remaining) {
        wrapped.push('');
        continue;
      }
      while (remaining.length > width) {
        let breakAt = remaining.lastIndexOf(' ', width);
        if (breakAt <= 0) breakAt = width;
        wrapped.push(remaining.substring(0, breakAt).trimEnd());
        remaining = remaining.substring(breakAt).trimStart();
      }
      wrapped.push(remaining);
    }
    return wrapped;
  },

  // Pause prompt
  pausePrompt: `\r\n${CSI}96m── ${CSI}97mPress Enter to continue ${CSI}96m──${CSI}0m`,

  // More prompt for paging
  morePrompt: `${CSI}96m── ${CSI}97m[C]ontinue, [S]top, [N]onstop ${CSI}96m──${CSI}0m`,
};

const safeCharMap = new Map([
  ['─', '-'],
  ['│', '|'],
  ['┌', '+'],
  ['┐', '+'],
  ['└', '+'],
  ['┘', '+'],
  ['├', '+'],
  ['┤', '+'],
  ['┬', '+'],
  ['┴', '+'],
  ['┼', '+'],
  ['═', '='],
  ['║', '|'],
  ['╔', '+'],
  ['╗', '+'],
  ['╚', '+'],
  ['╝', '+'],
  ['╠', '+'],
  ['╣', '+'],
  ['╦', '+'],
  ['╩', '+'],
  ['╬', '+'],
  ['█', '#'],
  ['▄', '_'],
  ['▀', '^'],
  ['░', '.'],
  ['•', '*'],
  ['✓', '+'],
  ['✗', 'x'],
  ['★', '*'],
  ['✦', '*'],
]);

ansi.normalizeOutput = (text) => {
  if (typeof text !== 'string') return text;

  const normalizedNewlines = text.replace(/\r?\n/g, '\r\n');
  return Array.from(normalizedNewlines, (char) => safeCharMap.get(char) || char).join('');
};

function framedRow(borderColor, content = '', width = 54) {
  const visibleLength = ansi.stripCodes(content).length;
  return `${borderColor}    │${content}${' '.repeat(Math.max(0, width - visibleLength))}${borderColor}│`;
}

ansi.frameRow = framedRow;

// ═══════════════════════════════════════════════════════════════
// ANSI Art Screens
// ═══════════════════════════════════════════════════════════════

ansi.art = {};

ansi.art.welcome = () => {
  const r = ansi.reset;
  const c = ansi.brightCyan;
  const m = ansi.brightMagenta;
  const y = ansi.brightYellow;
  const w = ansi.brightWhite;
  const g = ansi.brightGreen;
  const d = ansi.cyan;
  const dm = ansi.magenta;

  return ansi.clear +
`${d}
${c}    ╔══════════════════════════════════════════════════════╗
${c}    ║${w}                    THE NODEHOUSE                     ${c}║
${c}    ║${m}                 powered by Nodehouse                 ${c}║
${c}    ╚══════════════════════════════════════════════════════╝
${r}
${d}    ┌──────────────────────────────────────────────────────┐
${d}    │  ${w}${'The Nodehouse: a self-hosted community BBS'.padEnd(50)}${d}  │
${d}    │  ${dm}${'Messages, files, callers, chat, and door games'.padEnd(50)}${d}  │
${d}    └──────────────────────────────────────────────────────┘
${r}
${y}    ═══════════════════════════════════════════════════════${r}

`;
};

ansi.art.loginPrompt = () => {
  const c = ansi.brightCyan;
  const w = ansi.brightWhite;
  const g = ansi.green;
  const r = ansi.reset;

  return `${c}    ┌─────────────────────────────────┐
${c}    │  ${w}Enter your credentials below   ${c}  │
${c}    │  ${g}or type ${w}NEW${g} to register        ${c}  │
${c}    └─────────────────────────────────┘${r}

`;
};

ansi.art.mainMenu = (status = {}) => {
  const r = ansi.reset;
  const c = ansi.brightCyan;
  const y = ansi.brightYellow;
  const w = ansi.brightWhite;
  const g = ansi.brightGreen;
  const d = ansi.cyan;

  const rows = [
    framedRow(d, `  ${c}NODEHOUSE // NODE ${w}${String(status.nodeNum || 0).substring(0, 3).padEnd(3)}${d}                ${w}MAIN MENU`),
    `${d}    ├──────────────────────────────────────────────────────┤`,
    framedRow(d, `  ${g}Caller:${w} ${String(status.username || '').substring(0, 16).padEnd(16)} ${g}Call:${w} ${String(status.callCount || 0)}`),
    framedRow(d, `  ${g}Mail:${w} ${String(status.unreadMail || 0)}   ${g}New:${w} ${String(status.unreadMessages || 0)}   ${g}Mode:${w} ${String(status.menuMode || 'NOVICE').substring(0, 8)}`),
    `${d}    ├──────────────────────────────────────────────────────┤`,
    framedRow(d, `  ${y}[${w}M${y}]${c} Message Conferences  ${y}[${w}E${y}]${c} Electronic Mail`),
    framedRow(d, `  ${y}[${w}F${y}]${c} File Libraries       ${y}[${w}D${y}]${c} Door Games`),
    framedRow(d, `  ${y}[${w}B${y}]${c} Bulletins            ${y}[${w}T${y}]${c} TeleChat`),
    framedRow(d, `  ${y}[${w}N${y}]${c} New Message Scan     ${y}[${w}L${y}]${c} Last Callers`),
    framedRow(d, `  ${y}[${w}W${y}]${c} Who's Online         ${y}[${w}V${y}]${c} Voting Booth`),
    framedRow(d, `  ${y}[${w}O${y}]${c} One-Liners           ${y}[${w}Y${y}]${c} Your Settings`),
    framedRow(d, `  ${y}[${w}P${y}]${c} Page SysOp           ${y}[${w}S${y}]${c} System Information`),
    framedRow(d, `  ${y}[${w}X${y}]${c} Menu Mode            ${y}[${w}G${y}]${c} Goodbye / Logoff`),
  ];

  return ansi.clear + `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
    `${rows.join('\r\n')}\r\n` +
    `${d}    └──────────────────────────────────────────────────────┘\r\n${r}\r\n`;
};

ansi.art.mainPrompt = (status = {}, terse = false) => {
  const d = ansi.cyan;
  const c = ansi.brightCyan;
  const y = ansi.brightYellow;
  const w = ansi.brightWhite;
  const g = ansi.brightGreen;
  const r = ansi.reset;

  if (terse) return `${c}    Main>${w} `;
  return `${d}    Main ${y}[${w}M E F D B T N L W V O Y P S X G ?${y}] ` +
    `${g}Mail:${w}${status.unreadMail || 0} ${g}New:${w}${status.unreadMessages || 0}${r}\r\n` +
    `${c}    Main>${w} `;
};

ansi.art.logonSummary = (summary = {}) => {
  const r = ansi.reset;
  const c = ansi.brightCyan;
  const y = ansi.brightYellow;
  const w = ansi.brightWhite;
  const g = ansi.brightGreen;
  const d = ansi.cyan;
  const previousCaller = summary.previousCaller || 'None recorded';

  const rows = [
    framedRow(d, `  ${c}NODEHOUSE // SINCE YOUR LAST CALL`),
    `${d}    ├──────────────────────────────────────────────────────┤`,
    framedRow(d, `  ${g}Welcome:${w} ${String(summary.username || '').substring(0, 18).padEnd(18)} ${g}Node:${w} ${String(summary.nodeNum || 0)}`),
    framedRow(d, `  ${g}Last call:${w} ${String(summary.lastCall || 'First call').substring(0, 32)}`),
    framedRow(d, `  ${g}Previous caller:${w} ${String(previousCaller).substring(0, 28)}`),
    `${d}    ├──────────────────────────────────────────────────────┤`,
    framedRow(d, `  ${y}Electronic mail waiting:${w} ${String(summary.unreadMail || 0).padStart(5)}`),
    framedRow(d, `  ${y}New conference messages:${w} ${String(summary.unreadMessages || 0).padStart(5)}`),
    framedRow(d, `  ${y}New file entries:${w}         ${String(summary.newFiles || 0).padStart(5)}`),
    framedRow(d, `  ${y}Callers since last call:${w}  ${String(summary.callersSince || 0).padStart(5)}`),
    framedRow(d, `  ${y}Calls today:${w}              ${String(summary.callsToday || 0).padStart(5)}`),
  ];

  return ansi.clear + `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
    `${rows.join('\r\n')}\r\n` +
    `${d}    └──────────────────────────────────────────────────────┘${r}\r\n` +
    ansi.pausePrompt;
};

ansi.art.messageBases = (bases) => {
  const r = ansi.reset;
  const c = ansi.brightCyan;
  const y = ansi.brightYellow;
  const w = ansi.brightWhite;
  const g = ansi.brightGreen;
  const d = ansi.cyan;
  const m = ansi.brightMagenta;

  let screen = ansi.clear +
    `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
    `${framedRow(d, `  ${c}NODEHOUSE // MESSAGE CONFERENCES`)}\r\n` +
    `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
    `${framedRow(d, `  ${y}${'#'.padEnd(4)}${w}${'Conference Name'.padEnd(30)}${g}${'Msgs'.padStart(6)}  New`)}\r\n` +
    `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

  if (bases && bases.length > 0) {
    let currentSection = null;
    for (const base of bases) {
      if (base.section && base.section !== currentSection) {
        currentSection = base.section;
        const section = currentSection.toUpperCase().substring(0, 50);
        const sectionColor = currentSection === 'Vibe Community' ? m : c;
        screen += `${framedRow(d, `  ${sectionColor}${section}`)}\r\n`;
      }
      const num = String(base.id).padEnd(4);
      const name = String(base.name || '').substring(0, 28).padEnd(28);
      const total = String(base.totalMessages || 0).padStart(6);
      const unread = String(base.newMessages || 0).padStart(6);
      screen += `${framedRow(d, `  ${y}${num}${w}${name}  ${c}${total}  ${g}${unread}`)}\r\n`;
    }
  }

  screen += `${d}    ├──────────────────────────────────────────────────────┤\r\n`;
  screen += `${framedRow(d, `  ${y}[${w}#${y}]${c} Select   ${y}[${w}N${y}]${c} Newscan all   ${y}[${w}Q${y}]${c} Main Menu`)}\r\n`;
  screen += `${d}    └──────────────────────────────────────────────────────┘\r\n${r}\r\n`;
  return screen;
};

ansi.art.messageRead = (msg) => {
  const r = ansi.reset;
  const c = ansi.brightCyan;
  const y = ansi.brightYellow;
  const w = ansi.brightWhite;
  const g = ansi.brightGreen;
  const d = ansi.cyan;
  const bodyRows = ansi.wrapText(msg.body || '', 52)
    .map(line => framedRow(d, `  ${w}${line}`));
  const rows = [
    framedRow(d, ` ${y}Conference: ${w}${String(msg.conference || 'Local').substring(0, 38)}`),
    framedRow(d, ` ${y}Msg#: ${w}${String(msg.id).substring(0, 8).padEnd(8)} ${y}Date: ${w}${String(msg.date || '').substring(0, 20)}`),
    framedRow(d, ` ${y}From: ${w}${String(msg.fromUser || '').substring(0, 20).padEnd(20)} ${y}To: ${w}${String(msg.toUser || 'All').substring(0, 17)}`),
    framedRow(d, ` ${y}Subj: ${w}${String(msg.subject || '').substring(0, 44)}`),
    `${d}    ├──────────────────────────────────────────────────────┤`,
    ...bodyRows,
    `${d}    ├──────────────────────────────────────────────────────┤`,
    framedRow(d, ` ${y}[${w}F${y}]${c}ollow-up ${y}[${w}R${y}]${c}eply mail ${y}[${w}N${y}]${c}ext ${y}[${w}P${y}]${c}rev ${y}[${w}Q${y}]${c}uit`),
  ];

  return `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
    `${rows.join('\r\n')}\r\n` +
    `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;
};

ansi.art.goodbye = () => {
  const r = ansi.reset;
  const c = ansi.brightCyan;
  const m = ansi.brightMagenta;
  const y = ansi.brightYellow;
  const w = ansi.brightWhite;

  return ansi.clear +
`
${c}    ╔══════════════════════════════════════════════════════╗
${c}    ║                                                      ║
${c}    ║  ${y}  ████  █████  █████     █   █ ████  ██████ █████  ${c}║
${c}    ║  ${y}  █     █   █  █   █     █   █  ██   █    █ █      ${c}║
${c}    ║  ${y}  █  ██ █   █  █   █     █   █  ██   █████  ████   ${c}║
${c}    ║  ${y}  █   █ █   █  █   █      █ █   ██   █    █ █      ${c}║
${c}    ║  ${y}  ████  █████  █████       █   ████  ██████ █████  ${c}║
${c}    ║                                                      ║
${c}    ║  ${m}Thanks for calling The Nodehouse. Stay curious! ${w}✦   ${c}║
${c}    ║  ${w}Your session has been logged. Call again soon!     ${c}║
${c}    ║                                                      ║
${c}    ╚══════════════════════════════════════════════════════╝${r}

`;
};

ansi.art.whosOnline = (nodes) => {
  const r = ansi.reset;
  const c = ansi.brightCyan;
  const y = ansi.brightYellow;
  const w = ansi.brightWhite;
  const g = ansi.brightGreen;
  const d = ansi.cyan;

  let screen = ansi.clear +
`${d}    ┌──────────────────────────────────────────────────────┐
${d}    │${w}                  Who's Online                        ${d}│
${d}    ├──────────────────────────────────────────────────────┤
${d}    │  ${y}Node  ${w}Username             ${g}Activity               ${d}│
${d}    ├──────────────────────────────────────────────────────┤\r\n`;

  if (nodes && nodes.length > 0) {
    for (const node of nodes) {
      const nodeNum = String(node.nodeNum).padEnd(6);
      const user = (node.username || 'Logging in...').padEnd(20);
      const activity = (node.activity || 'Idle').padEnd(22);
      screen += `${d}    │  ${y}${nodeNum}${w}${user} ${g}${activity} ${d}│\r\n`;
    }
  } else {
    screen += `${d}    │  ${w}No other users online                               ${d}│\r\n`;
  }

  screen += `${d}    └──────────────────────────────────────────────────────┘${r}
${ansi.pausePrompt}`;
  return screen;
};

ansi.art.lastCallers = (calls = []) => {
  const r = ansi.reset;
  const c = ansi.brightCyan;
  const y = ansi.brightYellow;
  const w = ansi.brightWhite;
  const g = ansi.brightGreen;
  const d = ansi.cyan;

  let screen = ansi.clear +
    `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
    `${framedRow(d, `  ${c}NODEHOUSE // LAST CALLERS`)}\r\n` +
    `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
    `${framedRow(d, `  ${y}${'Caller'.padEnd(18)}${w}${'Logon'.padEnd(18)}${g}${'Node'.padEnd(6)}${c}Status`)}\r\n` +
    `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

  if (calls.length === 0) {
    screen += `${framedRow(d, `  ${w}No calls have been logged yet.`)}\r\n`;
  } else {
    for (const call of calls.slice(0, 15)) {
      const username = String(call.username || 'Unknown').substring(0, 18).padEnd(18);
      const login = String(call.login_time || '').substring(5, 16).padEnd(18);
      const node = String(call.node_num || '-').padEnd(6);
      const status = call.online ? 'ON ' : 'OFF';
      screen += `${framedRow(d, `  ${y}${username}${w}${login}${g}${node}${c}${status}`)}\r\n`;
    }
  }

  screen += `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;
  screen += ansi.pausePrompt;
  return screen;
};

ansi.art.systemStats = (stats) => {
  const r = ansi.reset;
  const c = ansi.brightCyan;
  const y = ansi.brightYellow;
  const w = ansi.brightWhite;
  const g = ansi.brightGreen;
  const d = ansi.cyan;

  return ansi.clear +
`${d}    ┌──────────────────────────────────────────────────────┐
${d}    │${w}                 System Information                  ${d}│
${d}    ├──────────────────────────────────────────────────────┤
${d}    │  ${y}Total Users:     ${w}${String(stats.totalUsers || 0).padStart(8)}                         ${d}│
${d}    │  ${y}Total Messages:  ${w}${String(stats.totalMessages || 0).padStart(8)}                         ${d}│
${d}    │  ${y}Total Calls:     ${w}${String(stats.totalCalls || 0).padStart(8)}                         ${d}│
${d}    │  ${y}Nodes Online:    ${w}${String(stats.nodesOnline || 0).padStart(8)}                         ${d}│
${d}    │  ${y}Max Nodes:       ${w}${String(stats.maxNodes || 0).padStart(8)}                         ${d}│
${d}    │  ${y}BBS Version:     ${w}${String(version).padStart(8)}                         ${d}│
${d}    │  ${y}Uptime:          ${w}${(stats.uptime || 'N/A').padStart(8)}                         ${d}│
${d}    └──────────────────────────────────────────────────────┘${r}
${ansi.pausePrompt}`;
};

module.exports = ansi;
