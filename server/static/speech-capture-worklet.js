"use strict";

class FluentMeSpeechCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    let cursor = 0;
    while (cursor < channel.length) {
      const count = Math.min(channel.length - cursor, this.buffer.length - this.offset);
      this.buffer.set(channel.subarray(cursor, cursor + count), this.offset);
      this.offset += count;
      cursor += count;
      if (this.offset === this.buffer.length) {
        const complete = this.buffer;
        this.port.postMessage(complete, [complete.buffer]);
        this.buffer = new Float32Array(2048);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("fluent-me-speech-capture", FluentMeSpeechCaptureProcessor);
