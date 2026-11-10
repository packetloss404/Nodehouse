'use strict';

// Maintenance: pause new calls, wait for the board to empty, run jobs, reopen.

const { runBackup } = require('../../scripts/backup');

class Maintenance {
  constructor({ config, nodeManager, backup } = {}) {
    this.config = config || {};
    this.nodeManager = nodeManager;
    this.backup = backup || (() => runBackup());
    this.draining = false;
    this.timer = null;
    this.jobs = [{ name: 'backup', lastRunAt: null, lastStatus: 'never', lastError: null, lastResult: null }];
  }

  start() {
    const hour = Number(this.config.maintenanceHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
    this.timer = setInterval(() => {
      const now = new Date();
      if (now.getHours() === hour && now.getMinutes() === 0) this.runJob('backup');
    }, 60 * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  runJob(name) {
    const job = this.jobs.find((item) => item.name === name);
    if (!job) return null;
    try {
      const result = this.backup();
      job.lastRunAt = new Date().toISOString();
      job.lastStatus = 'ok';
      job.lastError = null;
      job.lastResult = result && result.target ? result.target : null;
    } catch (error) {
      job.lastRunAt = new Date().toISOString();
      job.lastStatus = 'error';
      job.lastError = String((error && error.message) || error);
    }
    return job;
  }

  // Refuse new calls, tell everyone, and resolve once the board is empty or the
  // timeout passes.
  beginDrain({ timeoutMs = 10000 } = {}) {
    this.draining = true;
    this.nodeManager.broadcast('\r\n*** Maintenance: new calls are paused. ***\r\n');
    return new Promise((resolve) => {
      const started = Date.now();
      const check = setInterval(() => {
        const remaining = this.nodeManager.getOnlineCount();
        if (remaining === 0 || Date.now() - started >= timeoutMs) {
          clearInterval(check);
          resolve({ drained: remaining === 0, remaining });
        }
      }, 200);
      check.unref?.();
    });
  }

  endDrain() {
    this.draining = false;
  }

  status() {
    return { draining: this.draining, jobs: this.jobs };
  }
}

module.exports = { Maintenance };
