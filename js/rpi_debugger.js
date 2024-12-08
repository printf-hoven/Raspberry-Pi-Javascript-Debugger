class RPIDebugger {

  static state = { stopped: -1, running: 0, starting: -2, unavailable_or_error: -3 };

  #line_break_transformer = class {

    #chunks;

    constructor() {

      this.#chunks = "";

    }

    transform(chunk, controller) {

      this.#chunks += chunk;

      const lines = this.#chunks.split(/\r?\n|\r|\n/g);

      this.#chunks = lines.pop();

      lines.forEach((line) => controller.enqueue(line));

    }

    flush(controller) {

      controller.enqueue(this.#chunks);

    }

  };

  #serial_port;

  async start_raspberry_pi() {

    if (!("serial" in navigator)) {

      alert("Serial Communication is not supported in this browser or device.");

      this.#publish_state(RPIDebugger.state.unavailable_or_error);

      return;
    }

    this.#publish_message("Starting...", true);

    this.#publish_state(RPIDebugger.state.starting);

    // select the first saved port
    await navigator.serial.getPorts().then((ports) => { ports.forEach((port) => { this.#serial_port = port; console.log(port.getInfo().usbVendorId); return; }); });

    // ask user if none saved
    if (!this.#serial_port) { this.#serial_port = await navigator.serial.requestPort([{ usbVendorId: 0x2E8A }]).catch(() => this.#publish_state(RPIDebugger.state.stopped)); }

    if (!(this.#serial_port instanceof SerialPort)) { console.log("Nothing selected? Otherwise close the browser and retry."); return; }

    await this.#serial_port.open({ baudRate: 9600 });

    this.#publish_message("Connected at 9600!");

    const textDecoder = new TextDecoderStream();

    const readableStreamClosed = this.#serial_port.readable.pipeTo(textDecoder.writable);

    const reader = textDecoder.readable.pipeThrough(new TransformStream(new this.#line_break_transformer())).getReader();

    this.#publish_state(RPIDebugger.state.running);

    // Listen to data coming from the serial device.
    while (true) {

      try {

        const { value, done } = await reader.read();

        if (done) {

          reader.releaseLock();

          break;
        }

        this.#publish_message(value);

      }
      catch { break; }
    }

    await reader.cancel().catch(() => {/* Ignore the error */ });

    await readableStreamClosed.catch(() => { /* Ignore the error */ });

    await this.#serial_port.close();

    this.#serial_port = null;
  }

  async restart_raspberry_pi() {

    this.#publish_state(RPIDebugger.state.starting);

    await this.#write_to_COMM(/* r */114);

    this.#publish_message("Restarting in 2 seconds...", true);

    window.setTimeout(async () => { await this.start_raspberry_pi(); }, 2000);
  }

  async exit_raspberry_pi() { this.#publish_state(RPIDebugger.state.unavailable_or_error); await this.#write_to_COMM(/* q */113); }

  #publish_state(ui_state) {

    document.dispatchEvent(new CustomEvent("hovenstate", { detail: ui_state }));

  }

  #publish_message(msg, clear_que) {

    document.dispatchEvent(new CustomEvent("hovenlog", { detail: { text: msg, clear: clear_que } }));
  }

  async #write_to_COMM(c) {

    const writer = this.#serial_port.writable.getWriter();

    const data = new Uint8Array([c]); // hello

    await writer.write(data);

    // Allow the serial port to be closed later.
    await writer.releaseLock();
  }
};