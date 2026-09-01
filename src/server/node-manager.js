// Multi-node manager for The Nodehouse
// Tracks all active connections/nodes

class NodeManager {
  constructor(maxNodes) {
    this.maxNodes = maxNodes;
    this.nodes = new Map(); // nodeNum -> { session, username, activity, connectedAt }
  }

  allocateNode(session) {
    for (let i = 1; i <= this.maxNodes; i++) {
      if (!this.nodes.has(i)) {
        this.nodes.set(i, {
          session,
          username: null,
          activity: 'Logging in',
          connectedAt: new Date(),
        });
        return i;
      }
    }
    return null; // No nodes available
  }

  releaseNode(nodeNum) {
    this.nodes.delete(nodeNum);
  }

  setUsername(nodeNum, username) {
    const node = this.nodes.get(nodeNum);
    if (node) node.username = username;
  }

  setActivity(nodeNum, activity) {
    const node = this.nodes.get(nodeNum);
    if (node) node.activity = activity;
  }

  getNode(nodeNum) {
    return this.nodes.get(nodeNum);
  }

  getOnlineUsers() {
    const online = [];
    for (const [nodeNum, node] of this.nodes) {
      online.push({
        nodeNum,
        username: node.username,
        activity: node.activity,
        connectedAt: node.connectedAt,
      });
    }
    return online;
  }

  getOnlineCount() {
    return this.nodes.size;
  }

  findNodeBySession(session) {
    for (const [nodeNum, node] of this.nodes) {
      if (node.session === session) return nodeNum;
    }
    return null;
  }

  broadcast(message, excludeNode = null) {
    for (const [nodeNum, node] of this.nodes) {
      if (nodeNum !== excludeNode && node.session) {
        node.session.write(message);
      }
    }
  }
}

module.exports = NodeManager;
