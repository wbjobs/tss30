(function (global) {
  'use strict';

  class MoodLightWS {
    constructor(url) {
      this.url = url || this._defaultUrl();
      this.ws = null;
      this.deviceId = null;
      this.connected = false;
      this.reconnecting = false;
      this.peerCount = 0;
      this.peers = [];
      this.mergedColor = null;
      this.reconnectDelay = 1000;
      this.maxReconnectDelay = 15000;
      this._heartbeatTimer = null;
      this._reconnectTimer = null;
      this._wasConnected = false;

      this.onConnect = null;
      this.onDisconnect = null;
      this.onPeerJoin = null;
      this.onPeerLeave = null;
      this.onStateUpdate = null;
    }

    _defaultUrl() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${location.host}/ws`;
    }

    connect() {
      if (this.ws && this.ws.readyState === 1) return;
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
        this.ws = null;
      }

      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        console.warn('WS connect error:', e.message);
        this._scheduleReconnect();
        return;
      }

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectDelay = 1000;
        this._wasConnected = true;
        this._startHeartbeat();
        if (typeof this.onConnect === 'function') {
          this.onConnect({ device_id: this.deviceId });
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleMessage(msg);
        } catch (e) {
          console.warn('WS parse error:', e.message);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.peerCount = 0;
        this.peers = [];
        this.mergedColor = null;
        this._stopHeartbeat();
        if (typeof this.onDisconnect === 'function') {
          this.onDisconnect();
        }
        if (!this.reconnecting) {
          this._scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.warn('WS error');
      };
    }

    disconnect() {
      this.reconnecting = false;
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      this._stopHeartbeat();
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
        this.ws = null;
      }
      this.connected = false;
      this.peerCount = 0;
      this.peers = [];
    }

    _scheduleReconnect() {
      this.reconnecting = true;
      if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => {
        this.reconnecting = false;
        this.connect();
      }, this.reconnectDelay);
      this.reconnectDelay = Math.min(this.maxReconnectDelay, this.reconnectDelay * 2);
    }

    _startHeartbeat() {
      this._stopHeartbeat();
      this._heartbeatTimer = setInterval(() => {
        this.send({ type: 'heartbeat' });
      }, 3000);
    }

    _stopHeartbeat() {
      if (this._heartbeatTimer) {
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
      }
    }

    _handleMessage(msg) {
      switch (msg.type) {
        case 'welcome':
          this.deviceId = msg.device_id;
          this.peerCount = msg.peer_count || 0;
          this.peers = msg.peers || [];
          if (typeof this.onConnect === 'function' && this._wasConnected === false) {
            this.onConnect({ device_id: this.deviceId });
          }
          break;

        case 'state':
          this.peerCount = msg.peer_count || 0;
          this.peers = msg.peers || [];
          this.mergedColor = msg.merged || null;
          if (typeof this.onStateUpdate === 'function') {
            this.onStateUpdate({
              peer_count: this.peerCount,
              peers: this.peers,
              merged: this.mergedColor,
              timestamp: msg.timestamp,
            });
          }
          break;

        case 'peer_join':
          this.peerCount = msg.peer_count || 0;
          if (typeof this.onPeerJoin === 'function') {
            this.onPeerJoin({
              device_id: msg.device_id,
              device: msg.device,
              peer_count: this.peerCount,
            });
          }
          break;

        case 'peer_leave':
          this.peerCount = msg.peer_count || 0;
          if (typeof this.onPeerLeave === 'function') {
            this.onPeerLeave({
              device_id: msg.device_id,
              peer_count: this.peerCount,
            });
          }
          break;

        case 'ping':
          this.send({ type: 'pong' });
          break;
      }
    }

    send(data) {
      if (!this.ws || this.ws.readyState !== 1) return false;
      try {
        this.ws.send(JSON.stringify(data));
        return true;
      } catch (e) {
        return false;
      }
    }

    sendColor(result) {
      const features = result.features || {};
      return this.send({
        type: 'color_update',
        r: result.rgb ? result.rgb.r : result.r || 0,
        g: result.rgb ? result.rgb.g : result.g || 0,
        b: result.rgb ? result.rgb.b : result.b || 0,
        h: result.hsl ? result.hsl.h : result.h || 0,
        s: result.hsl ? result.hsl.s : result.s || 0,
        l: result.hsl ? result.hsl.l : result.l || 0,
        energy: features.overall_energy !== undefined
          ? features.overall_energy
          : (result.energy || 0),
        emotion_label: result.emotion_label || '',
        is_silent: !!result.is_silent,
        dominance: result.dominance || '',
      });
    }
  }

  global.MoodLightWS = MoodLightWS;
})(typeof window !== 'undefined' ? window : globalThis);
