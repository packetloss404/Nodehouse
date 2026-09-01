// BBS Session - State machine for a single user connection
const ansi = require('./ansi');
const db = require('./database');
const config = require('../../config.json');

const MAX_INPUT_BUFFER_LENGTH = 4096;
const MAX_INPUT_CHUNK_BYTES = 64 * 1024;
const MAX_LOGIN_ATTEMPTS_PER_SESSION = 5;
const MIN_USER_PASSWORD_LENGTH = 8;

const STATES = {
  LOGIN_USERNAME: 'login_username',
  LOGIN_PASSWORD: 'login_password',
  NEW_USER_USERNAME: 'new_user_username',
  NEW_USER_PASSWORD: 'new_user_password',
  NEW_USER_CONFIRM: 'new_user_confirm',
  NEW_USER_REALNAME: 'new_user_realname',
  LOGON_SUMMARY: 'logon_summary',
  MAIN_MENU: 'main_menu',
  MESSAGE_BASES: 'message_bases',
  MESSAGE_LIST: 'message_list',
  MESSAGE_READ: 'message_read',
  MESSAGE_WRITE_TO: 'message_write_to',
  MESSAGE_WRITE_SUBJECT: 'message_write_subject',
  MESSAGE_WRITE_BODY: 'message_write_body',
  MESSAGE_WRITE_CONFIRM: 'message_write_confirm',
  FILE_AREAS: 'file_areas',
  FILE_LIST: 'file_list',
  DOOR_GAMES: 'door_games',
  DOOR_PLAYING: 'door_playing',
  BULLETINS: 'bulletins',
  WHOS_ONLINE: 'whos_online',
  LAST_CALLERS: 'last_callers',
  SYSTEM_STATS: 'system_stats',
  USER_SETTINGS: 'user_settings',
  USER_SETTINGS_FIELD: 'user_settings_field',
  CHAT_ROOMS: 'chat_rooms',
  CHAT_ACTIVE: 'chat_active',
  GRAFFITI_WALL: 'graffiti_wall',
  GRAFFITI_WRITE: 'graffiti_write',
  PRIVATE_MAIL_MENU: 'private_mail_menu',
  PRIVATE_MAIL_INBOX: 'private_mail_inbox',
  PRIVATE_MAIL_READ: 'private_mail_read',
  PRIVATE_MAIL_WRITE_TO: 'private_mail_write_to',
  PRIVATE_MAIL_WRITE_SUBJECT: 'private_mail_write_subject',
  PRIVATE_MAIL_WRITE_BODY: 'private_mail_write_body',
  POLLS_LIST: 'polls_list',
  POLL_VIEW: 'poll_view',
  POLL_VOTE: 'poll_vote',
  MOTD: 'motd',
  GOODBYE: 'goodbye',
  PAGE_SYSOP: 'page_sysop',
  PAUSE: 'pause',
};

class BBSSession {
  constructor(transport, nodeNum, nodeManager, security = {}) {
    this.transport = transport;
    this.nodeNum = nodeNum;
    this.nodeManager = nodeManager;
    this.user = null;
    this.state = STATES.LOGIN_USERNAME;
    this.inputBuffer = '';
    this.inputEcho = true;
    this.callLogId = null;
    this.sessionEnded = false;
    this.security = security;
    this.loginAttempts = 0;

    // State-specific data
    this.stateData = {};
    this.previousState = null;
    this.pauseCallback = null;

    // Door game instance
    this.doorGame = null;

    this.showWelcome();
  }

  showWelcome() {
    this.write(ansi.art.welcome());
    this.write(ansi.art.loginPrompt());
    this.prompt('Username: ');
  }

  write(data) {
    try {
      // Normalize line endings: bare \n → \r\n for proper terminal display
      const normalized = data.replace(/\r?\n/g, '\r\n');
      this.transport.write(normalized);
    } catch (e) {
      // Connection may have closed
    }
  }

  prompt(text) {
    this.write(`${ansi.brightCyan}    ${text}${ansi.brightWhite}`);
  }

  handleData(data) {
    if (this.sessionEnded) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length > MAX_INPUT_CHUNK_BYTES) {
      this.endConnection('Input limit exceeded.');
      return;
    }

    for (let i = 0; i < buf.length; i++) {
      const byte = buf[i];

      // Handle Telnet IAC sequences (skip them)
      if (byte === 0xFF) {
        i += 2; // Skip IAC + command + option
        continue;
      }

      // Backspace
      if (byte === 0x08 || byte === 0x7F) {
        if (this.inputBuffer.length > 0) {
          this.inputBuffer = this.inputBuffer.slice(0, -1);
          this.write('\b \b');
        }
        continue;
      }

      // Enter (CR or LF)
      if (byte === 0x0D || byte === 0x0A) {
        // Skip LF after CR
        if (byte === 0x0D && i + 1 < buf.length && buf[i + 1] === 0x0A) {
          i++;
        }
        this.write('\r\n');
        const input = this.inputBuffer.trim();
        this.inputBuffer = '';
        this.processInput(input);
        if (this.sessionEnded) return;
        continue;
      }

      // Regular printable character
      if (byte >= 0x20 && byte < 0x7F) {
        if (this.inputBuffer.length >= MAX_INPUT_BUFFER_LENGTH) {
          this.write('\x07');
          continue;
        }
        const char = String.fromCharCode(byte);
        this.inputBuffer += char;
        if (this.inputEcho) {
          this.write(char);
        } else {
          this.write('*');
        }
      }
    }
  }

  // Handle single-key input (no Enter required)
  handleSingleKey(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    for (let i = 0; i < buf.length; i++) {
      const byte = buf[i];
      if (byte === 0xFF) { i += 2; continue; }
      if (byte >= 0x20 && byte < 0x7F) {
        return String.fromCharCode(byte).toUpperCase();
      }
      if (byte === 0x0D || byte === 0x0A) return '\r';
    }
    return null;
  }

  processInput(input) {
    if (this.sessionEnded) return;
    switch (this.state) {
      case STATES.LOGIN_USERNAME:
        this.handleLoginUsername(input);
        break;
      case STATES.LOGIN_PASSWORD:
        this.handleLoginPassword(input);
        break;
      case STATES.NEW_USER_USERNAME:
        this.handleNewUserUsername(input);
        break;
      case STATES.NEW_USER_PASSWORD:
        this.handleNewUserPassword(input);
        break;
      case STATES.NEW_USER_CONFIRM:
        this.handleNewUserConfirm(input);
        break;
      case STATES.NEW_USER_REALNAME:
        this.handleNewUserRealname(input);
        break;
      case STATES.LOGON_SUMMARY:
        this.continueAfterLogon();
        break;
      case STATES.MAIN_MENU:
        this.handleMainMenu(input);
        break;
      case STATES.MESSAGE_BASES:
        this.handleMessageBases(input);
        break;
      case STATES.MESSAGE_LIST:
        this.handleMessageList(input);
        break;
      case STATES.MESSAGE_READ:
        this.handleMessageRead(input);
        break;
      case STATES.MESSAGE_WRITE_TO:
        this.handleMessageWriteTo(input);
        break;
      case STATES.MESSAGE_WRITE_SUBJECT:
        this.handleMessageWriteSubject(input);
        break;
      case STATES.MESSAGE_WRITE_BODY:
        this.handleMessageWriteBody(input);
        break;
      case STATES.MESSAGE_WRITE_CONFIRM:
        this.handleMessageWriteConfirm(input);
        break;
      case STATES.FILE_AREAS:
        this.handleFileAreas(input);
        break;
      case STATES.FILE_LIST:
        this.handleFileList(input);
        break;
      case STATES.DOOR_GAMES:
        this.handleDoorGames(input);
        break;
      case STATES.DOOR_PLAYING:
        if (this.doorGame) {
          this.doorGame.handleInput(input);
        }
        break;
      case STATES.BULLETINS:
        this.handleBulletins(input);
        break;
      case STATES.WHOS_ONLINE:
      case STATES.LAST_CALLERS:
      case STATES.SYSTEM_STATS:
      case STATES.PAGE_SYSOP:
        this.showMainMenu();
        break;
      case STATES.PAUSE:
        if (this.pauseCallback) {
          const cb = this.pauseCallback;
          this.pauseCallback = null;
          cb();
        }
        break;
      case STATES.USER_SETTINGS:
        this.handleUserSettings(input);
        break;
      case STATES.USER_SETTINGS_FIELD:
        this.handleUserSettingsField(input);
        break;
      case STATES.CHAT_ROOMS:
        this.handleChatRooms(input);
        break;
      case STATES.CHAT_ACTIVE:
        this.handleChatActive(input);
        break;
      case STATES.GRAFFITI_WALL:
        this.handleGraffitiWall(input);
        break;
      case STATES.GRAFFITI_WRITE:
        this.handleGraffitiWrite(input);
        break;
      case STATES.PRIVATE_MAIL_MENU:
        this.handlePrivateMailMenu(input);
        break;
      case STATES.PRIVATE_MAIL_INBOX:
        this.handlePrivateMailInbox(input);
        break;
      case STATES.PRIVATE_MAIL_READ:
        this.handlePrivateMailRead(input);
        break;
      case STATES.PRIVATE_MAIL_WRITE_TO:
        this.handlePrivateMailWriteTo(input);
        break;
      case STATES.PRIVATE_MAIL_WRITE_SUBJECT:
        this.handlePrivateMailWriteSubject(input);
        break;
      case STATES.PRIVATE_MAIL_WRITE_BODY:
        this.handlePrivateMailWriteBody(input);
        break;
      case STATES.POLLS_LIST:
        this.handlePollsList(input);
        break;
      case STATES.POLL_VIEW:
        this.handlePollView(input);
        break;
      case STATES.POLL_VOTE:
        this.handlePollVote(input);
        break;
      case STATES.MOTD:
        this.showMainMenu(true);
        break;
      default:
        this.showMainMenu();
    }
  }

  // ─── LOGIN ───────────────────────────────────────────────

  handleLoginUsername(input) {
    if (!input) {
      this.prompt('Username: ');
      return;
    }

    if (input.toUpperCase() === 'NEW') {
      if (!config.allowNewUsers) {
        this.write(`\r\n${ansi.brightRed}    New user registration is currently disabled.${ansi.reset}\r\n\r\n`);
        this.prompt('Username: ');
        return;
      }
      if (this.security.consumeRegistration && !this.security.consumeRegistration()) {
        this.write(`\r\n${ansi.brightRed}    Registration limit reached. Please try again later.${ansi.reset}\r\n\r\n`);
        this.prompt('Username: ');
        return;
      }
      this.write(`\r\n${ansi.brightGreen}    ── New User Registration ──${ansi.reset}\r\n\r\n`);
      this.state = STATES.NEW_USER_USERNAME;
      this.prompt('Choose a username: ');
      return;
    }

    this.stateData.loginUsername = input;
    this.state = STATES.LOGIN_PASSWORD;
    this.inputEcho = false;
    this.prompt('Password: ');
  }

  handleLoginPassword(input) {
    this.inputEcho = true;

    const user = db.users.authenticate(this.stateData.loginUsername, input);
    if (!user) {
      this.loginAttempts += 1;
      const remoteAllowed = this.security.recordLoginFailure
        ? this.security.recordLoginFailure()
        : true;
      if (this.loginAttempts >= MAX_LOGIN_ATTEMPTS_PER_SESSION || !remoteAllowed) {
        this.endConnection('Too many failed login attempts. Please try again later.');
        return;
      }
      this.write(`\r\n${ansi.brightRed}    Invalid username or password!${ansi.reset}\r\n\r\n`);
      this.state = STATES.LOGIN_USERNAME;
      this.prompt('Username: ');
      return;
    }

    this.loginUser(user);
  }

  handleNewUserUsername(input) {
    if (!input || input.length < 2 || input.length > 30) {
      this.write(`${ansi.brightRed}    Username must be 2-30 characters.${ansi.reset}\r\n`);
      this.prompt('Choose a username: ');
      return;
    }

    const existing = db.users.findByUsername(input);
    if (existing) {
      this.write(`${ansi.brightRed}    That username is already taken!${ansi.reset}\r\n`);
      this.prompt('Choose a username: ');
      return;
    }

    this.stateData.newUsername = input;
    this.state = STATES.NEW_USER_PASSWORD;
    this.inputEcho = false;
    this.prompt('Choose a password: ');
  }

  handleNewUserPassword(input) {
    if (!input || input.length < MIN_USER_PASSWORD_LENGTH) {
      this.write(`\r\n${ansi.brightRed}    Password must be at least ${MIN_USER_PASSWORD_LENGTH} characters.${ansi.reset}\r\n`);
      this.prompt('Choose a password: ');
      return;
    }

    this.stateData.newPassword = input;
    this.state = STATES.NEW_USER_CONFIRM;
    this.write('\r\n');
    this.prompt('Confirm password: ');
  }

  handleNewUserConfirm(input) {
    this.inputEcho = true;
    if (input !== this.stateData.newPassword) {
      this.write(`\r\n${ansi.brightRed}    Passwords do not match!${ansi.reset}\r\n`);
      this.state = STATES.NEW_USER_PASSWORD;
      this.inputEcho = false;
      this.prompt('Choose a password: ');
      return;
    }

    this.state = STATES.NEW_USER_REALNAME;
    this.write('\r\n');
    this.prompt('Your real name (optional): ');
  }

  handleNewUserRealname(input) {
    try {
      const user = db.users.create(this.stateData.newUsername, this.stateData.newPassword, input || '');
      this.write(`\r\n${ansi.brightGreen}    Account created successfully! Welcome, ${user.username}!${ansi.reset}\r\n`);
      this.loginUser(user);
    } catch (e) {
      this.write(`\r\n${ansi.brightRed}    Error creating account. Please try again.${ansi.reset}\r\n`);
      this.state = STATES.LOGIN_USERNAME;
      this.prompt('Username: ');
    }
  }

  loginUser(user) {
    const previousLastCall = user.last_call_date;
    this.user = user;
    db.users.updateLastCall(user.id);
    this.callLogId = db.callLog.logLogin(user.id, user.username, this.nodeNum);
    this.user = db.users.getById(user.id);
    this.nodeManager.setUsername(this.nodeNum, user.username);
    this.nodeManager.setActivity(this.nodeNum, 'Reading logon summary');

    // Broadcast login notification
    this.nodeManager.broadcast(
      `\r\n${ansi.brightYellow}    *** ${user.username} has logged in on Node ${this.nodeNum} ***${ansi.reset}\r\n`,
      this.nodeNum
    );

    const accessibleBaseIds = this.getAccessibleMessageBases().map((base) => base.id);
    const previousCaller = db.callLog.getPrevious(this.callLogId);
    this.stateData.logonSummary = {
      username: user.username,
      nodeNum: this.nodeNum,
      lastCall: formatLocalDateTime(previousLastCall) || 'First call',
      previousCaller: previousCaller ? previousCaller.username : null,
      unreadMail: db.privateMail.countUnread(user.username),
      unreadMessages: db.messages.countUnreadByBases(accessibleBaseIds, user.id),
      newFiles: db.files.countSince(previousLastCall),
      callersSince: db.callLog.countSince(previousLastCall, user.id),
      callsToday: db.callLog.countToday(),
    };
    this.showLogonSummary();
  }

  getAccessibleMessageBases() {
    if (!this.user) return [];
    return config.messageBases.filter((base) => base.accessLevel <= this.user.access_level);
  }

  getMainStatus() {
    const accessibleBaseIds = this.getAccessibleMessageBases().map((base) => base.id);
    return {
      username: this.user.username,
      nodeNum: this.nodeNum,
      callCount: this.user.total_calls,
      unreadMail: db.privateMail.countUnread(this.user.username),
      unreadMessages: db.messages.countUnreadByBases(accessibleBaseIds, this.user.id),
      menuMode: this.user.menu_mode || 'NOVICE',
    };
  }

  showLogonSummary() {
    this.state = STATES.LOGON_SUMMARY;
    this.write(ansi.art.logonSummary(this.stateData.logonSummary));
  }

  continueAfterLogon() {
    const motdEntry = db.motd.getActive();
    if (motdEntry) {
      this.showMotd(motdEntry);
    } else {
      this.showMainMenu(true);
    }
  }

  // ─── MAIN MENU ──────────────────────────────────────────

  showMainMenu(forceFull = false) {
    this.state = STATES.MAIN_MENU;
    this.nodeManager.setActivity(this.nodeNum, 'Main Menu');
    const user = db.users.findByUsername(this.user.username);
    if (user) this.user = user;
    const status = this.getMainStatus();
    const menuMode = status.menuMode;
    if (forceFull || menuMode === 'NOVICE') {
      this.write(ansi.art.mainMenu(status));
      this.prompt('Main command (? for menu): ');
      return;
    }
    this.write(ansi.art.mainPrompt(status, menuMode === 'SUPER'));
  }

  handleMainMenu(input) {
    const cmd = (input || '').toUpperCase();
    if (!cmd) {
      this.showMainMenu();
      return;
    }
    switch (cmd) {
      case 'M':
        this.showMessageBases();
        break;
      case 'E':
        this.showPrivateMailMenu();
        break;
      case 'F':
        this.showFileAreas();
        break;
      case 'D':
        this.showDoorGames();
        break;
      case 'B':
        this.showBulletins();
        break;
      case 'T':
      case 'C': // Legacy alias
        this.showChatRooms();
        break;
      case 'N':
        this.startNewMessageScan();
        break;
      case 'L':
        this.showLastCallers();
        break;
      case 'O':
      case 'R': // Legacy alias
        this.showGraffitiWall();
        break;
      case 'V':
        this.showPollsList();
        break;
      case 'W':
        this.showWhosOnline();
        break;
      case 'Y':
      case 'U': // Legacy alias
        this.showUserSettings();
        break;
      case 'P':
        this.showPageSysop();
        break;
      case 'S':
        this.showSystemStats();
        break;
      case 'X':
        this.cycleMenuMode();
        break;
      case '?':
        this.showMainMenu(true);
        break;
      case 'G':
        this.doGoodbye();
        break;
      default:
        this.write(`${ansi.brightRed}    Invalid command! Press ? for the menu.${ansi.reset}\r\n`);
        this.showMainMenu();
    }
  }

  cycleMenuMode(returnToSettings = false) {
    const modes = ['NOVICE', 'EXPERT', 'SUPER'];
    const current = (this.user.menu_mode || 'NOVICE').toUpperCase();
    const currentIndex = modes.indexOf(current);
    const next = modes[(currentIndex + 1 + modes.length) % modes.length];
    db.users.update(this.user.id, { menu_mode: next });
    this.user = db.users.getById(this.user.id);
    this.write(`${ansi.brightGreen}    Menu mode set to ${next}.${ansi.reset}\r\n`);
    if (returnToSettings) {
      this.showUserSettings();
    } else {
      this.showMainMenu(next === 'NOVICE');
    }
  }

  // ─── MESSAGE BASES ──────────────────────────────────────

  showMessageBases() {
    this.state = STATES.MESSAGE_BASES;
    this.nodeManager.setActivity(this.nodeNum, 'Message Conferences');

    const bases = this.getAccessibleMessageBases()
      .map(b => ({
        ...b,
        totalMessages: db.messages.countByBase(b.id),
        newMessages: db.messages.countUnreadByBase(b.id, this.user.id),
      }));

    this.write(ansi.art.messageBases(bases));
    this.prompt('Conference #: ');
  }

  handleMessageBases(input) {
    if (!input || input.toUpperCase() === 'Q') {
      this.showMainMenu();
      return;
    }

    if (input.toUpperCase() === 'N') {
      this.startNewMessageScan();
      return;
    }

    const baseId = parseInt(input);
    const base = config.messageBases.find(b => b.id === baseId);
    if (!base || base.accessLevel > this.user.access_level) {
      this.write(`${ansi.brightRed}    Invalid conference number!${ansi.reset}\r\n`);
      this.prompt('Conference #: ');
      return;
    }

    this.stateData.currentBase = base;
    this.showMessageList();
  }

  startNewMessageScan() {
    const bases = this.getAccessibleMessageBases();
    const unread = [];
    for (const base of bases) {
      for (const message of db.messages.getUnreadByBase(base.id, this.user.id)) {
        unread.push(message);
      }
    }

    if (unread.length === 0) {
      this.write(`\r\n${ansi.brightYellow}    No new messages in your accessible conferences.${ansi.reset}\r\n`);
      this.showMainMenu();
      return;
    }

    this.stateData.messages = unread;
    this.stateData.messageIndex = 0;
    this.stateData.scanMode = 'GLOBAL';
    this.write(`\r\n${ansi.brightGreen}    New-message scan: ${unread.length} message${unread.length === 1 ? '' : 's'}.${ansi.reset}\r\n`);
    this.showMessage(unread[0]);
  }

  showMessageList() {
    this.state = STATES.MESSAGE_LIST;
    const base = this.stateData.currentBase;
    const msgs = db.messages.getByBase(base.id);
    this.stateData.messages = msgs;
    this.stateData.messageIndex = 0;
    this.stateData.scanMode = null;

    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    let screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${d}    │  ${w}${base.name.padEnd(50)} ${d}│\r\n` +
      `${d}    │  ${g}${base.description.padEnd(50)} ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
      `${d}    │  ${y}#     ${w}Subject                  ${c}From          ${g}Date    ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

    if (msgs.length === 0) {
      screen += `${d}    │  ${w}No messages in this conference.                      ${d}│\r\n`;
    } else {
      for (const msg of msgs.slice(0, 20)) {
        const num = String(msg.id).padEnd(6);
        const subj = (msg.subject || '').substring(0, 24).padEnd(24);
        const from = (msg.from_user || '').substring(0, 13).padEnd(13);
        const date = (msg.created_at || '').substring(5, 10).padEnd(7);
        screen += `${d}    │  ${y}${num}${w}${subj} ${c}${from} ${g}${date}${d}│\r\n`;
      }
    }

    screen += `${d}    ├──────────────────────────────────────────────────────┤\r\n`;
    screen += `${d}    │  ${y}[${w}#${y}]${c}Read msg  ${y}[${w}W${y}]${c}rite  ${y}[${w}N${y}]${c}ew msgs  ${y}[${w}Q${y}]${c}uit       ${d}  │\r\n`;
    screen += `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Message command: ');
  }

  handleMessageList(input) {
    if (!input) {
      this.prompt('Message command: ');
      return;
    }

    const cmd = input.toUpperCase();

    if (cmd === 'Q') {
      this.showMessageBases();
      return;
    }

    if (cmd === 'W') {
      this.state = STATES.MESSAGE_WRITE_TO;
      this.stateData.newMessage = {};
      this.prompt('To (or "All"): ');
      return;
    }

    if (cmd === 'N') {
      const unread = db.messages.getUnreadByBase(this.stateData.currentBase.id, this.user.id);
      if (unread.length > 0) {
        this.stateData.messages = unread;
        this.stateData.messageIndex = 0;
        this.stateData.scanMode = 'BASE';
        this.showMessage(unread[0]);
      } else {
        this.write(`${ansi.brightYellow}    No new messages.${ansi.reset}\r\n`);
        this.prompt('Message command: ');
      }
      return;
    }

    // Try to read a specific message number
    const msgId = parseInt(cmd);
    if (!isNaN(msgId)) {
      const msg = db.messages.getById(msgId);
      if (msg && msg.base_id === this.stateData.currentBase.id) {
        const idx = this.stateData.messages.findIndex(m => m.id === msgId);
        if (idx >= 0) this.stateData.messageIndex = idx;
        this.showMessage(msg);
        return;
      }
    }

    this.write(`${ansi.brightRed}    Invalid command!${ansi.reset}\r\n`);
    this.prompt('Message command: ');
  }

  showMessage(msg) {
    this.state = STATES.MESSAGE_READ;
    this.stateData.currentMessage = msg;
    const base = config.messageBases.find(item => item.id === msg.base_id);
    if (base) this.stateData.currentBase = base;
    db.messages.markRead(msg.id, this.user.id);

    const display = {
      id: msg.id,
      conference: base ? base.name : `Conference ${msg.base_id}`,
      date: msg.created_at || '',
      fromUser: msg.from_user || '',
      toUser: msg.to_user || 'All',
      subject: msg.subject || '',
      body: msg.body || '',
    };

    this.write(ansi.art.messageRead(display));
    this.prompt('F/R/N/P/Q: ');
  }

  rememberMessageReturn() {
    this.stateData.composeReturn = {
      source: 'MESSAGE_READ',
      messages: this.stateData.messages,
      messageIndex: this.stateData.messageIndex,
      scanMode: this.stateData.scanMode,
      currentBase: this.stateData.currentBase,
    };
  }

  finishCompose(fallback) {
    const context = this.stateData.composeReturn;
    this.stateData.composeReturn = null;
    if (context && context.source === 'MESSAGE_READ') {
      this.stateData.messages = context.messages;
      this.stateData.messageIndex = context.messageIndex;
      this.stateData.scanMode = context.scanMode;
      this.stateData.currentBase = context.currentBase;
      const message = context.messages && context.messages[context.messageIndex];
      if (message) {
        this.showMessage(message);
        return;
      }
    }
    fallback();
  }

  handleMessageRead(input) {
    const cmd = (input || '').toUpperCase();
    const msgs = this.stateData.messages;

    switch (cmd) {
      case 'F':
        this.rememberMessageReturn();
        this.state = STATES.MESSAGE_WRITE_SUBJECT;
        this.stateData.newMessage = {
          replyTo: this.stateData.currentMessage.id,
          subject: 'Re: ' + (this.stateData.currentMessage.subject || '').replace(/^Re: /i, ''),
          to: 'All',
        };
        this.write(`\r\n${ansi.brightGreen}    Public follow-up in ${this.stateData.currentBase.name}${ansi.reset}\r\n`);
        this.prompt(`Subject [${this.stateData.newMessage.subject}]: `);
        break;
      case 'R':
        this.rememberMessageReturn();
        this.state = STATES.PRIVATE_MAIL_WRITE_TO;
        this.stateData.newMail = {
          to: this.stateData.currentMessage.from_user,
          subject: 'Re: ' + (this.stateData.currentMessage.subject || '').replace(/^Re: /i, ''),
        };
        this.write(`\r\n${ansi.brightGreen}    Private reply to ${this.stateData.currentMessage.from_user}${ansi.reset}\r\n`);
        this.prompt(`To [${this.stateData.newMail.to}]: `);
        break;
      case 'N':
        if (this.stateData.messageIndex < msgs.length - 1) {
          this.stateData.messageIndex++;
          this.showMessage(msgs[this.stateData.messageIndex]);
        } else {
          const scanMode = this.stateData.scanMode;
          this.stateData.scanMode = null;
          this.write(`${ansi.brightYellow}    End of ${scanMode ? 'new-message scan' : 'messages'}.${ansi.reset}\r\n`);
          if (scanMode === 'GLOBAL') {
            this.showMainMenu();
          } else if (scanMode === 'BASE') {
            this.showMessageList();
          } else {
            this.prompt('F/R/N/P/Q: ');
          }
        }
        break;
      case 'P':
        if (this.stateData.messageIndex > 0) {
          this.stateData.messageIndex--;
          this.showMessage(msgs[this.stateData.messageIndex]);
        } else {
          this.write(`${ansi.brightYellow}    Beginning of messages.${ansi.reset}\r\n`);
          this.prompt('F/R/N/P/Q: ');
        }
        break;
      case 'Q':
        if (this.stateData.scanMode === 'GLOBAL') {
          this.stateData.scanMode = null;
          this.showMainMenu();
        } else {
          this.stateData.scanMode = null;
          this.showMessageList();
        }
        break;
      default:
        this.write(`${ansi.brightRed}    Invalid command!${ansi.reset}\r\n`);
        this.prompt('F/R/N/P/Q: ');
        break;
    }
  }

  // ─── MESSAGE WRITING ────────────────────────────────────

  handleMessageWriteTo(input) {
    const nm = this.stateData.newMessage;
    nm.to = input || nm.to || 'All';
    this.state = STATES.MESSAGE_WRITE_SUBJECT;
    if (nm.subject) {
      this.prompt(`Subject [${nm.subject}]: `);
    } else {
      this.prompt('Subject: ');
    }
  }

  handleMessageWriteSubject(input) {
    const nm = this.stateData.newMessage;
    nm.subject = input || nm.subject || '';
    if (!nm.subject) {
      this.write(`${ansi.brightRed}    Subject cannot be empty!${ansi.reset}\r\n`);
      this.prompt('Subject: ');
      return;
    }
    this.state = STATES.MESSAGE_WRITE_BODY;
    this.stateData.messageLines = [];
    this.write(`\r\n${ansi.brightGreen}    Enter your message (type ${ansi.brightWhite}/S${ansi.brightGreen} to save, ${ansi.brightWhite}/A${ansi.brightGreen} to abort):${ansi.reset}\r\n`);
    this.write(`${ansi.cyan}    ──────────────────────────────────────────${ansi.reset}\r\n`);
    this.prompt('│ ');
  }

  handleMessageWriteBody(input) {
    if (input.toUpperCase() === '/S') {
      const body = this.stateData.messageLines.join('\r\n');
      if (!body.trim()) {
        this.write(`${ansi.brightRed}    Message is empty! Aborted.${ansi.reset}\r\n`);
        this.finishCompose(() => this.showMessageList());
        return;
      }

      const nm = this.stateData.newMessage;
      const base = this.stateData.currentBase;
      const messageId = db.messages.create(
        base.id,
        this.user.username,
        nm.to,
        nm.subject,
        body,
        nm.replyTo || null
      );
      db.messages.markRead(messageId, this.user.id);
      db.users.incrementPosts(this.user.id);

      this.write(`\r\n${ansi.brightGreen}    Message saved!${ansi.reset}\r\n`);
      this.finishCompose(() => this.showMessageList());
      return;
    }

    if (input.toUpperCase() === '/A') {
      this.write(`${ansi.brightYellow}    Message aborted.${ansi.reset}\r\n`);
      this.finishCompose(() => this.showMessageList());
      return;
    }

    this.stateData.messageLines.push(input);
    this.prompt('│ ');
  }

  // ─── FILE AREAS ─────────────────────────────────────────

  showFileAreas() {
    this.state = STATES.FILE_AREAS;
    this.nodeManager.setActivity(this.nodeNum, 'File Libraries');

    const areas = config.fileAreas.filter(a => a.accessLevel <= this.user.access_level);
    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    let screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${d}    │${w}                  File Libraries                      ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
      `${d}    │  ${y}#   ${w}Area Name                    ${g}Files              ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

    for (const area of areas) {
      const num = String(area.id).padEnd(4);
      const name = area.name.padEnd(28);
      const files = String(db.files.getByArea(area.id).length).padStart(5);
      screen += `${d}    │  ${y}${num}${w}${name} ${c}${files}              ${d}│\r\n`;
    }

    screen += `${d}    ├──────────────────────────────────────────────────────┤\r\n`;
    screen += `${d}    │  ${y}[${w}#${y}]${c} Select area   ${y}[${w}Q${y}]${c} Return to Main Menu         ${d}  │\r\n`;
    screen += `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Area #: ');
  }

  handleFileAreas(input) {
    if (!input || input.toUpperCase() === 'Q') {
      this.showMainMenu();
      return;
    }

    const areaId = parseInt(input);
    const area = config.fileAreas.find(a => a.id === areaId);
    if (!area || area.accessLevel > this.user.access_level) {
      this.write(`${ansi.brightRed}    Invalid area!${ansi.reset}\r\n`);
      this.prompt('Area #: ');
      return;
    }

    this.stateData.currentFileArea = area;
    this.showFileList();
  }

  showFileList() {
    this.state = STATES.FILE_LIST;
    const area = this.stateData.currentFileArea;
    const files = db.files.getByArea(area.id);

    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    let screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${d}    │  ${w}${area.name.padEnd(50)} ${d}│\r\n` +
      `${d}    │  ${g}${area.description.padEnd(50)} ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

    if (files.length === 0) {
      screen += `${d}    │  ${w}No files in this area yet.                           ${d}│\r\n`;
    } else {
      screen += `${d}    │  ${y}Filename             ${w}Size     ${c}By            ${g}DLs   ${d}│\r\n`;
      screen += `${d}    ├──────────────────────────────────────────────────────┤\r\n`;
      for (const file of files) {
        const name = file.filename.substring(0, 20).padEnd(20);
        const size = formatSize(file.size).padStart(8);
        const by = (file.uploaded_by || '').substring(0, 13).padEnd(13);
        const dls = String(file.download_count).padStart(5);
        screen += `${d}    │  ${y}${name} ${w}${size} ${c}${by} ${g}${dls} ${d}│\r\n`;
      }
    }

    screen += `${d}    ├──────────────────────────────────────────────────────┤\r\n`;
    screen += `${d}    │  ${y}[${w}Q${y}]${c} Return to File Libraries                      ${d}    │\r\n`;
    screen += `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Command: ');
  }

  handleFileList(input) {
    this.showFileAreas();
  }

  // ─── DOOR GAMES ─────────────────────────────────────────

  showDoorGames() {
    this.state = STATES.DOOR_GAMES;
    this.nodeManager.setActivity(this.nodeNum, 'Door Games');

    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const m = ansi.brightMagenta;
    const d = ansi.cyan;

    const screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${d}    │${m}       ██████   ██████   ██████  ██████  ██████       ${d}│\r\n` +
      `${d}    │${m}       ██   ██ ██    ██ ██    ██ ██   ██ ██           ${d}│\r\n` +
      `${d}    │${m}       ██   ██ ██    ██ ██    ██ ██████  ██████       ${d}│\r\n` +
      `${d}    │${m}       ██   ██ ██    ██ ██    ██ ██   ██     ██       ${d}│\r\n` +
      `${d}    │${m}       ██████   ██████   ██████  ██   ██ ██████       ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
      `${d}    │                                                      │\r\n` +
      `${d}    │  ${y}[${w}1${y}]${c} Vibe Wars          ${g}Intergalactic AI trading   ${d}│\r\n` +
      `${d}    │  ${y}[${w}2${y}]${c} Prompt Quest        ${g}AI dungeon crawler          ${d}│\r\n` +
      `${d}    │  ${y}[${w}3${y}]${c} Token Tycoon        ${g}Build your AI empire       ${d}│\r\n` +
      `${d}    │  ${y}[${w}4${y}]${c} Stack Overflow      ${g}Classic Hangman, dev-style  ${d}│\r\n` +
      `${d}    │  ${y}[${w}5${y}]${c} Dungeon of the      ${g}AI Dungeon Master MUD      ${d}│\r\n` +
      `${d}    │      ${c} Vibe Lords         ${g}(Claude is your DM!)       ${d}│\r\n` +
      `${d}    │                                                      │\r\n` +
      `${d}    │  ${y}[${w}Q${y}]${c} Return to Main Menu                            ${d}  │\r\n` +
      `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Door #: ');
  }

  handleDoorGames(input) {
    const cmd = (input || '').toUpperCase();
    if (cmd === 'Q' || !cmd) {
      this.showMainMenu();
      return;
    }

    const doorNum = parseInt(cmd);
    if (doorNum >= 1 && doorNum <= 5) {
      this.launchDoor(doorNum);
    } else {
      this.write(`${ansi.brightRed}    Invalid selection!${ansi.reset}\r\n`);
      this.prompt('Door #: ');
    }
  }

  launchDoor(doorNum) {
    const doorNames = { 1: 'VibeWars', 2: 'PromptQuest', 3: 'TokenTycoon', 4: 'StackOverflow', 5: 'DungeonOfTheVibeLords' };
    this.nodeManager.setActivity(this.nodeNum, `Playing ${doorNames[doorNum]}`);

    try {
      const DoorClass = require(`../doors/door${doorNum}`);
      this.doorGame = new DoorClass(this);
      this.state = STATES.DOOR_PLAYING;
      this.doorGame.start();
    } catch (e) {
      this.write(`${ansi.brightRed}    Door game not available: ${e.message}${ansi.reset}\r\n`);
      this.showDoorGames();
    }
  }

  exitDoor() {
    this.doorGame = null;
    this.showDoorGames();
  }

  // ─── BULLETINS ──────────────────────────────────────────

  showBulletins() {
    this.state = STATES.BULLETINS;
    this.nodeManager.setActivity(this.nodeNum, 'Bulletins');

    const bulletins = db.bulletins.getActive();
    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    let screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${d}    │${w}                   System Bulletins                   ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

    if (bulletins.length === 0) {
      screen += `${d}    │  ${w}No bulletins at this time.                          ${d}│\r\n`;
    } else {
      for (const b of bulletins) {
        screen += `${d}    │  ${y}#${b.id} ${w}${b.title.padEnd(40)} ${g}${(b.created_at || '').substring(0, 10)}${d}│\r\n`;
        const lines = b.body.split('\r\n');
        for (const line of lines) {
          screen += `${d}    │  ${c}${line.substring(0, 52).padEnd(52)}${d}│\r\n`;
        }
        screen += `${d}    │${'─'.repeat(54)}│\r\n`;
      }
    }

    screen += `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;
    screen += ansi.pausePrompt;

    this.write(screen);
  }

  handleBulletins(input) {
    this.showMainMenu();
  }

  // ─── OTHER SCREENS ──────────────────────────────────────

  showWhosOnline() {
    this.state = STATES.WHOS_ONLINE;
    this.nodeManager.setActivity(this.nodeNum, "Who's Online");
    const nodes = this.nodeManager.getOnlineUsers();
    this.write(ansi.art.whosOnline(nodes));
  }

  showLastCallers() {
    this.state = STATES.LAST_CALLERS;
    this.nodeManager.setActivity(this.nodeNum, 'Last Callers');
    const activeCallIds = new Set(
      Array.from(this.nodeManager.nodes.values())
        .map((node) => node.session && node.session.callLogId)
        .filter(Boolean)
    );
    const calls = db.callLog.getRecent(15)
      .map((call) => ({
        ...call,
        login_time: formatLocalDateTime(call.login_time),
        online: activeCallIds.has(call.id),
      }));
    this.write(ansi.art.lastCallers(calls));
  }

  showSystemStats() {
    this.state = STATES.SYSTEM_STATS;
    this.nodeManager.setActivity(this.nodeNum, 'System Information');

    const userStats = db.users.getStats();
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);

    const stats = {
      totalUsers: userStats.totalUsers,
      totalMessages: db.messages.getTotal(),
      totalCalls: userStats.totalCalls,
      nodesOnline: this.nodeManager.getOnlineCount(),
      maxNodes: config.maxNodes,
      uptime: `${hours}h ${mins}m`,
    };

    this.write(ansi.art.systemStats(stats));
  }

  showUserSettings() {
    this.state = STATES.USER_SETTINGS;
    this.nodeManager.setActivity(this.nodeNum, 'User Settings');

    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    const screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${ansi.frameRow(d, `  ${c}NODEHOUSE // YOUR SETTINGS`)}\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}1${y}]${c} Real Name:    ${w}${String(this.user.real_name || 'Not set').substring(0, 30)}`)}\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}2${y}]${c} Location:     ${w}${String(this.user.location || 'Not set').substring(0, 30)}`)}\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}3${y}]${c} Email:        ${w}${String(this.user.email || 'Not set').substring(0, 30)}`)}\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}4${y}]${c} Menu Mode:    ${w}${String(this.user.menu_mode || 'NOVICE').substring(0, 30)}`)}\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}Q${y}]${c} Return to Main Menu`)}\r\n` +
      `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Setting #: ');
  }

  handleUserSettings(input) {
    const cmd = (input || '').toUpperCase();
    if (cmd === 'Q' || !cmd) {
      this.showMainMenu();
      return;
    }

    const fields = { '1': 'real_name', '2': 'location', '3': 'email' };
    const labels = { '1': 'Real Name', '2': 'Location', '3': 'Email' };

    if (cmd === '4') {
      this.cycleMenuMode(true);
      return;
    }

    if (fields[cmd]) {
      this.stateData.settingField = fields[cmd];
      this.state = STATES.USER_SETTINGS_FIELD;
      this.prompt(`New ${labels[cmd]}: `);
    } else {
      this.prompt('Setting #: ');
    }
  }

  handleUserSettingsField(input) {
    if (input) {
      db.users.update(this.user.id, { [this.stateData.settingField]: input });
      this.user = db.users.getById(this.user.id);
      this.write(`${ansi.brightGreen}    Updated!${ansi.reset}\r\n`);
    }
    this.showUserSettings();
  }

  showPageSysop() {
    this.state = STATES.PAGE_SYSOP;
    this.nodeManager.setActivity(this.nodeNum, 'Paging SysOp');
    this.write(`\r\n${ansi.brightYellow}    *** Paging SysOp... ***${ansi.reset}\r\n`);
    this.write(`${ansi.brightCyan}    The SysOp has been notified. Please wait...${ansi.reset}\r\n`);

    // Notify sysop nodes
    for (const [nodeNum, node] of this.nodeManager.nodes) {
      if (node.session && node.session.user && node.session.user.access_level >= 200) {
        node.session.write(`\r\n${ansi.brightRed}${ansi.blink}    *** ${this.user.username} on Node ${this.nodeNum} is paging you! ***${ansi.reset}\r\n`);
      }
    }

    this.write(`${ansi.brightWhite}    SysOp is not available right now. Try again later!${ansi.reset}\r\n`);
    this.write(ansi.pausePrompt);
  }

  // ─── CHAT ROOMS ──────────────────────────────────────────

  showChatRooms() {
    this.state = STATES.CHAT_ROOMS;
    this.nodeManager.setActivity(this.nodeNum, 'TeleChat');

    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    const screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${ansi.frameRow(d, `  ${c}NODEHOUSE // TELECHAT`)}\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
      `${ansi.frameRow(d)}\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}1${y}]${c} The Lobby           ${g}General chat for everyone`)}\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}2${y}]${c} Vibe Lounge         ${g}Chill vibes only`)}\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}3${y}]${c} Code Corner         ${g}Talk shop, share code`)}\r\n` +
      `${ansi.frameRow(d)}\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}Q${y}]${c} Return to Main Menu`)}\r\n` +
      `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Room #: ');
  }

  handleChatRooms(input) {
    const cmd = (input || '').toUpperCase();
    if (cmd === 'Q' || !cmd) {
      this.showMainMenu();
      return;
    }

    const roomNames = { '1': 'The Lobby', '2': 'Vibe Lounge', '3': 'Code Corner' };
    if (roomNames[cmd]) {
      this.stateData.chatRoom = cmd;
      this.stateData.chatRoomName = roomNames[cmd];
      this.enterChat();
    } else {
      this.write(`${ansi.brightRed}    Invalid room!${ansi.reset}\r\n`);
      this.prompt('Room #: ');
    }
  }

  enterChat() {
    this.state = STATES.CHAT_ACTIVE;
    this.nodeManager.setActivity(this.nodeNum, `Chat: ${this.stateData.chatRoomName}`);

    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    this.write(ansi.clear);
    this.write(`${d}    ┌──────────────────────────────────────────────────────┐\r\n`);
    this.write(`${d}    │  ${w}Chat Room: ${c}${this.stateData.chatRoomName.padEnd(39)} ${d}│\r\n`);
    this.write(`${d}    │  ${g}Type /Q to quit, /W to see who's here               ${d}│\r\n`);
    this.write(`${d}    └──────────────────────────────────────────────────────┘${r}\r\n\r\n`);

    // Announce to other chatters in same room
    this.broadcastChat(`${ansi.brightYellow}*** ${this.user.username} has entered the room ***${ansi.reset}`);
    this.prompt('> ');
  }

  handleChatActive(input) {
    if (!input) {
      this.prompt('> ');
      return;
    }

    const cmd = input.toUpperCase();

    if (cmd === '/Q') {
      this.broadcastChat(`${ansi.brightYellow}*** ${this.user.username} has left the room ***${ansi.reset}`);
      this.showChatRooms();
      return;
    }

    if (cmd === '/W') {
      const chatters = [];
      for (const [nodeNum, node] of this.nodeManager.nodes) {
        if (node.session && node.session.stateData.chatRoom === this.stateData.chatRoom &&
            node.session.state === STATES.CHAT_ACTIVE) {
          chatters.push(node.username || 'Unknown');
        }
      }
      this.write(`${ansi.brightCyan}    In room: ${ansi.brightWhite}${chatters.join(', ')}${ansi.reset}\r\n`);
      this.prompt('> ');
      return;
    }

    // Broadcast message to all users in the same chat room
    this.broadcastChat(`${ansi.brightGreen}<${this.user.username}>${ansi.reset} ${input}`);
    this.prompt('> ');
  }

  broadcastChat(message) {
    for (const [nodeNum, node] of this.nodeManager.nodes) {
      if (node.session && node.session.stateData.chatRoom === this.stateData.chatRoom &&
          node.session.state === STATES.CHAT_ACTIVE) {
        if (nodeNum !== this.nodeNum) {
          node.session.write(`\r${ansi.eraseLine}    ${message}\r\n`);
          node.session.prompt('> ');
        }
      }
    }
  }

  // ─── GRAFFITI WALL ──────────────────────────────────────

  showGraffitiWall() {
    this.state = STATES.GRAFFITI_WALL;
    this.nodeManager.setActivity(this.nodeNum, 'One-Liners');

    const entries = db.graffiti.getRecent(15);
    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    let screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${ansi.frameRow(d, `  ${c}NODEHOUSE // ONE-LINERS`)}\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

    if (entries.length === 0) {
      screen += `${ansi.frameRow(d, `  ${w}No one-liners yet. Be the first to post!`)}\r\n`;
    } else {
      for (const entry of entries.reverse()) {
        const user = ansi.stripCodes(entry.username).substring(0, 12).padEnd(12);
        const msg = entry.message.substring(0, 38).padEnd(38);
        screen += `${ansi.frameRow(d, `  ${y}${user} ${w}${msg}`)}\r\n`;
      }
    }

    screen += `${d}    ├──────────────────────────────────────────────────────┤\r\n`;
    screen += `${ansi.frameRow(d, `  ${y}[${w}W${y}]${c} Write one-liner    ${y}[${w}Q${y}]${c} Return to Main Menu`)}\r\n`;
    screen += `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Command: ');
  }

  handleGraffitiWall(input) {
    const cmd = (input || '').toUpperCase();
    if (cmd === 'Q' || !cmd) {
      this.showMainMenu();
      return;
    }
    if (cmd === 'W') {
      this.state = STATES.GRAFFITI_WRITE;
      this.prompt('One-liner (max 38 chars): ');
      return;
    }
    this.prompt('Command: ');
  }

  handleGraffitiWrite(input) {
    if (!input) {
      this.showGraffitiWall();
      return;
    }

    const msg = input.substring(0, 38);
    db.graffiti.add(this.user.username, msg);
    this.write(`${ansi.brightGreen}    One-liner posted!${ansi.reset}\r\n`);
    this.showGraffitiWall();
  }

  // ─── PRIVATE MAIL ──────────────────────────────────────

  showPrivateMailMenu() {
    this.state = STATES.PRIVATE_MAIL_MENU;
    this.nodeManager.setActivity(this.nodeNum, 'Electronic Mail');

    const unread = db.privateMail.countUnread(this.user.username);
    const inbox = db.privateMail.getInbox(this.user.username);
    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    const screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${ansi.frameRow(d, `  ${c}NODEHOUSE // ELECTRONIC MAIL`)}\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
      `${ansi.frameRow(d, `  ${g}Inbox:${w} ${inbox.length}   ${g}Unread:${w} ${unread}`)}\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
      `${ansi.frameRow(d)}\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}I${y}]${c} Read Inbox        ${y}[${w}W${y}]${c} Write Mail`)}\r\n` +
      `${ansi.frameRow(d, `  ${y}[${w}Q${y}]${c} Return to Main Menu`)}\r\n` +
      `${ansi.frameRow(d)}\r\n` +
      `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Command: ');
  }

  handlePrivateMailMenu(input) {
    const cmd = (input || '').toUpperCase();
    if (cmd === 'Q' || !cmd) {
      this.showMainMenu();
      return;
    }
    if (cmd === 'I') {
      this.showPrivateMailInbox();
      return;
    }
    if (cmd === 'W') {
      this.state = STATES.PRIVATE_MAIL_WRITE_TO;
      this.stateData.newMail = {};
      this.prompt('To: ');
      return;
    }
    this.prompt('Command: ');
  }

  showPrivateMailInbox() {
    this.state = STATES.PRIVATE_MAIL_INBOX;
    const inbox = db.privateMail.getInbox(this.user.username);
    this.stateData.mailInbox = inbox;

    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    let screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${d}    │${w}                      Inbox                           ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
      `${d}    │  ${y}#    ${w}Subject                  ${c}From          ${g}Status ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

    if (inbox.length === 0) {
      screen += `${d}    │  ${w}No mail in your inbox.                              ${d}│\r\n`;
    } else {
      for (const mail of inbox.slice(0, 20)) {
        const num = String(mail.id).padEnd(5);
        const subj = (mail.subject || '').substring(0, 24).padEnd(24);
        const from = (mail.from_user || '').substring(0, 13).padEnd(13);
        const status = mail.read ? `${d}read  ` : `${g}NEW   `;
        screen += `${d}    │  ${y}${num}${w}${subj} ${c}${from} ${status}${d}│\r\n`;
      }
    }

    screen += `${d}    ├──────────────────────────────────────────────────────┤\r\n`;
    screen += `${d}    │  ${y}[${w}#${y}]${c} Read mail   ${y}[${w}Q${y}]${c} Back to Mail Menu             ${d}  │\r\n`;
    screen += `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Mail #: ');
  }

  handlePrivateMailInbox(input) {
    if (!input || input.toUpperCase() === 'Q') {
      this.showPrivateMailMenu();
      return;
    }

    const mailId = parseInt(input);
    if (!isNaN(mailId)) {
      const mail = db.privateMail.getById(mailId);
      if (mail && mail.to_user.toUpperCase() === this.user.username.toUpperCase()) {
        this.showPrivateMailRead(mail);
        return;
      }
    }

    this.write(`${ansi.brightRed}    Invalid mail number!${ansi.reset}\r\n`);
    this.prompt('Mail #: ');
  }

  showPrivateMailRead(mail) {
    this.state = STATES.PRIVATE_MAIL_READ;
    this.stateData.currentMail = mail;
    db.privateMail.markRead(mail.id);

    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    this.write(`${d}    ┌──────────────────────────────────────────────────────┐\r\n`);
    this.write(`${d}    │ ${y}Mail#: ${w}${String(mail.id).substring(0, 8).padEnd(8)} ${y}Date: ${w}${String(mail.created_at || '').substring(0, 20).padEnd(20)} ${d}     │\r\n`);
    this.write(`${d}    │ ${y}From:  ${w}${String(mail.from_user || '').substring(0, 20).padEnd(20)} ${y}To: ${w}${String(mail.to_user || '').substring(0, 17).padEnd(17)} ${d}│\r\n`);
    this.write(`${d}    │ ${y}Subj:  ${w}${String(mail.subject || '').substring(0, 44).padEnd(44)} ${d}│\r\n`);
    this.write(`${d}    ├──────────────────────────────────────────────────────┤\r\n`);
    this.write(`${d}    │${r}\r\n`);

    const lines = ansi.wrapText(mail.body || '', 52);
    for (const line of lines) {
      this.write(`${d}    │  ${w}${line.padEnd(52)}${d}│\r\n`);
    }

    this.write(`${d}    │\r\n`);
    this.write(`${d}    ├──────────────────────────────────────────────────────┤\r\n`);
    this.write(`${d}    │  ${y}[${w}R${y}]${c}eply  ${y}[${w}D${y}]${c}elete  ${y}[${w}Q${y}]${c}uit to inbox            ${d}    │\r\n`);
    this.write(`${d}    └──────────────────────────────────────────────────────┘${r}\r\n`);
    this.prompt('Command: ');
  }

  handlePrivateMailRead(input) {
    const cmd = (input || '').toUpperCase();

    if (cmd === 'R') {
      this.state = STATES.PRIVATE_MAIL_WRITE_TO;
      const mail = this.stateData.currentMail;
      this.stateData.newMail = {
        to: mail.from_user,
        subject: 'Re: ' + (mail.subject || '').replace(/^Re: /i, ''),
      };
      this.write(`\r\n${ansi.brightGreen}    Replying to ${mail.from_user}${ansi.reset}\r\n`);
      this.prompt(`To [${this.stateData.newMail.to}]: `);
      return;
    }

    if (cmd === 'D') {
      db.privateMail.delete(this.stateData.currentMail.id);
      this.write(`${ansi.brightYellow}    Mail deleted.${ansi.reset}\r\n`);
      this.showPrivateMailInbox();
      return;
    }

    this.showPrivateMailInbox();
  }

  handlePrivateMailWriteTo(input) {
    const nm = this.stateData.newMail;
    nm.to = input || nm.to || '';
    if (!nm.to) {
      this.write(`${ansi.brightRed}    Recipient cannot be empty!${ansi.reset}\r\n`);
      this.prompt('To: ');
      return;
    }

    // Verify user exists
    const recipient = db.users.findByUsername(nm.to);
    if (!recipient) {
      this.write(`${ansi.brightRed}    User not found!${ansi.reset}\r\n`);
      this.prompt('To: ');
      return;
    }
    nm.to = recipient.username; // Use canonical casing

    this.state = STATES.PRIVATE_MAIL_WRITE_SUBJECT;
    if (nm.subject) {
      this.prompt(`Subject [${nm.subject}]: `);
    } else {
      this.prompt('Subject: ');
    }
  }

  handlePrivateMailWriteSubject(input) {
    const nm = this.stateData.newMail;
    nm.subject = input || nm.subject || '';
    if (!nm.subject) {
      this.write(`${ansi.brightRed}    Subject cannot be empty!${ansi.reset}\r\n`);
      this.prompt('Subject: ');
      return;
    }

    this.state = STATES.PRIVATE_MAIL_WRITE_BODY;
    this.stateData.mailLines = [];
    this.write(`\r\n${ansi.brightGreen}    Enter your message (type ${ansi.brightWhite}/S${ansi.brightGreen} to send, ${ansi.brightWhite}/A${ansi.brightGreen} to abort):${ansi.reset}\r\n`);
    this.write(`${ansi.cyan}    ──────────────────────────────────────────${ansi.reset}\r\n`);
    this.prompt('│ ');
  }

  handlePrivateMailWriteBody(input) {
    if (input.toUpperCase() === '/S') {
      const body = this.stateData.mailLines.join('\r\n');
      if (!body.trim()) {
        this.write(`${ansi.brightRed}    Message is empty! Aborted.${ansi.reset}\r\n`);
        this.finishCompose(() => this.showPrivateMailMenu());
        return;
      }

      const nm = this.stateData.newMail;
      db.privateMail.send(this.user.username, nm.to, nm.subject, body);

      // Notify recipient if online
      for (const [nodeNum, node] of this.nodeManager.nodes) {
        if (node.username && node.username.toUpperCase() === nm.to.toUpperCase() && node.session) {
          node.session.write(`\r\n${ansi.brightYellow}    *** New private mail from ${this.user.username}! ***${ansi.reset}\r\n`);
        }
      }

      this.write(`\r\n${ansi.brightGreen}    Mail sent to ${nm.to}!${ansi.reset}\r\n`);
      this.finishCompose(() => this.showPrivateMailMenu());
      return;
    }

    if (input.toUpperCase() === '/A') {
      this.write(`${ansi.brightYellow}    Mail aborted.${ansi.reset}\r\n`);
      this.finishCompose(() => this.showPrivateMailMenu());
      return;
    }

    this.stateData.mailLines.push(input);
    this.prompt('│ ');
  }

  // ─── VOTING BOOTHS / POLLS ─────────────────────────────

  showPollsList() {
    this.state = STATES.POLLS_LIST;
    this.nodeManager.setActivity(this.nodeNum, 'Voting Booths');

    const activePolls = db.polls.getActive();
    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const m = ansi.brightMagenta;
    const d = ansi.cyan;

    let screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${d}    │${m}        ░█░█░█▀█░▀█▀░▀█▀░█▀█░█▀▀░░░░░░░░░░░░░       ${d}│\r\n` +
      `${d}    │${m}        ░▀▄▀░█░█░░█░░░█░░█░█░█░█░░░░░░░░░░░░░       ${d}│\r\n` +
      `${d}    │${m}        ░░▀░░▀▀▀░░▀░░▀▀▀░▀░▀░▀▀▀░░░░░░░░░░░░░       ${d}│\r\n` +
      `${d}    │${w}                  Voting Booths                       ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n` +
      `${d}    │  ${y}#   ${w}Question                                  ${g}By   ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

    if (activePolls.length === 0) {
      screen += `${d}    │  ${w}No active polls at this time.                      ${d}│\r\n`;
    } else {
      for (const poll of activePolls) {
        const num = String(poll.id).padEnd(4);
        const q = poll.question.substring(0, 38).padEnd(38);
        const by = (poll.author || '').substring(0, 5).padEnd(5);
        screen += `${d}    │  ${y}${num}${w}${q}${g}${by}${d}│\r\n`;
      }
    }

    screen += `${d}    ├──────────────────────────────────────────────────────┤\r\n`;
    screen += `${d}    │  ${y}[${w}#${y}]${c} View/Vote poll   ${y}[${w}Q${y}]${c} Return to Main Menu      ${d}  │\r\n`;
    screen += `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Poll #: ');
  }

  handlePollsList(input) {
    if (!input || input.toUpperCase() === 'Q') {
      this.showMainMenu();
      return;
    }

    const pollId = parseInt(input);
    if (!isNaN(pollId)) {
      const poll = db.polls.getById(pollId);
      if (poll && poll.active) {
        this.stateData.currentPoll = poll;
        this.showPollView();
        return;
      }
    }

    this.write(`${ansi.brightRed}    Invalid poll number!${ansi.reset}\r\n`);
    this.prompt('Poll #: ');
  }

  showPollView() {
    const poll = this.stateData.currentPoll;
    const hasVoted = db.polls.hasVoted(poll.id, this.user.id);
    const results = db.polls.getResults(poll.id);
    const totalVotes = db.polls.getTotalVotes(poll.id);

    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const m = ansi.brightMagenta;
    const d = ansi.cyan;

    let screen = ansi.clear +
      `${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${d}    │  ${w}${poll.question.substring(0, 50).padEnd(50)} ${d}│\r\n` +
      `${d}    │  ${g}By: ${c}${(poll.author || '').padEnd(20)} ${g}Votes: ${c}${String(totalVotes).padEnd(17)} ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

    for (const opt of results) {
      const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
      const barLen = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 25) : 0;
      const bar = '█'.repeat(barLen) + '░'.repeat(25 - barLen);
      const optNum = String(opt.id).padEnd(4);
      const optText = opt.option_text.substring(0, 15).padEnd(15);

      if (hasVoted) {
        screen += `${d}    │  ${y}${optText} ${m}${bar} ${w}${String(pct).padStart(3)}% ${c}(${opt.votes})${d}│\r\n`;
      } else {
        screen += `${d}    │  ${y}[${w}${optNum.trim()}${y}]${c} ${optText}                                    ${d}│\r\n`;
      }
    }

    screen += `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

    if (hasVoted) {
      this.state = STATES.POLL_VIEW;
      screen += `${d}    │  ${g}You have already voted.  ${y}[${w}Q${y}]${c} Back to polls        ${d}  │\r\n`;
    } else {
      this.state = STATES.POLL_VOTE;
      screen += `${d}    │  ${y}[${w}#${y}]${c} Vote   ${y}[${w}Q${y}]${c} Back to polls without voting         ${d}  │\r\n`;
    }

    screen += `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;

    this.write(screen);
    this.prompt('Choice: ');
  }

  handlePollView(input) {
    this.showPollsList();
  }

  handlePollVote(input) {
    if (!input || input.toUpperCase() === 'Q') {
      this.showPollsList();
      return;
    }

    const optionId = parseInt(input);
    if (!isNaN(optionId)) {
      const poll = this.stateData.currentPoll;
      const options = db.polls.getOptions(poll.id);
      const validOption = options.find(o => o.id === optionId);

      if (validOption) {
        db.polls.vote(poll.id, optionId, this.user.id);
        this.write(`\r\n${ansi.brightGreen}    Vote recorded! Thank you for voting.${ansi.reset}\r\n\r\n`);
        this.showPollView();
        return;
      }
    }

    this.write(`${ansi.brightRed}    Invalid option!${ansi.reset}\r\n`);
    this.prompt('Choice: ');
  }

  // ─── MOTD ──────────────────────────────────────────────

  showMotd(motdEntry) {
    this.state = STATES.MOTD;
    this.nodeManager.setActivity(this.nodeNum, 'Reading MOTD');

    const r = ansi.reset;
    const c = ansi.brightCyan;
    const y = ansi.brightYellow;
    const w = ansi.brightWhite;
    const g = ansi.brightGreen;
    const d = ansi.cyan;

    let screen = `\r\n${d}    ┌──────────────────────────────────────────────────────┐\r\n` +
      `${d}    │${y}              ── Message of the Day ──                 ${d}│\r\n` +
      `${d}    ├──────────────────────────────────────────────────────┤\r\n`;

    const lines = (motdEntry.body || '').split('\r\n');
    for (const line of lines) {
      screen += `${d}    │  ${w}${line.substring(0, 52).padEnd(52)}${d}│\r\n`;
    }

    screen += `${d}    │  ${g}                          - ${c}${(motdEntry.author || 'SysOp').padEnd(22)} ${d}│\r\n`;
    screen += `${d}    └──────────────────────────────────────────────────────┘${r}\r\n`;
    screen += ansi.pausePrompt;

    this.write(screen);
  }

  // ─── GOODBYE ────────────────────────────────────────────

  finalizeSession(action) {
    if (this.sessionEnded) return false;
    this.sessionEnded = true;

    if (this.callLogId) {
      db.callLog.logLogout(this.callLogId);
      this.callLogId = null;
    }

    if (this.user) {
      this.nodeManager.broadcast(
        `\r\n${ansi.brightYellow}    *** ${this.user.username} has ${action} Node ${this.nodeNum} ***${ansi.reset}\r\n`,
        this.nodeNum
      );
    }

    this.nodeManager.releaseNode(this.nodeNum);
    return true;
  }

  endConnection(message) {
    if (this.sessionEnded) return;
    this.write(`\r\n${ansi.brightRed}    ${message}${ansi.reset}\r\n`);
    this.finalizeSession('disconnected from');
    try {
      this.transport.end();
    } catch (e) {}
  }

  doGoodbye() {
    if (this.sessionEnded) return;
    this.state = STATES.GOODBYE;
    this.write(ansi.art.goodbye());
    this.finalizeSession('logged off from');

    setTimeout(() => {
      try {
        this.transport.end();
      } catch (e) {}
    }, 2000);
  }

  // Called when connection drops unexpectedly
  disconnect() {
    this.finalizeSession('disconnected from');
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K';
  return (bytes / (1024 * 1024)).toFixed(1) + 'M';
}

function formatLocalDateTime(value) {
  if (!value) return '';
  const timestamp = String(value);
  const isoTimestamp = /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp)
    ? timestamp
    : `${timestamp.replace(' ', 'T')}Z`;
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = BBSSession;
