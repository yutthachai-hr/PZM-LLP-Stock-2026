/**
 * The camera reader for a barcode sheet, as a session-generation controller.
 *
 * A camera is opened and closed many times in one visit (open, read, close, reopen on the
 * next line). The naive version — booleans reset on every open, and `stream.current = await
 * getUserMedia(...)` before the cancellation check — leaked the stream and let a stale frame
 * finish the session that came after it (R3 C4).
 *
 * This controller gives every open a monotonically increasing generation. Every promise it
 * awaits (getUserMedia, the zxing reader, a detector frame) captures the generation it began
 * under and is a no-op once that generation is no longer current; a stream that arrives late
 * is stopped before it can be shared, and controls that arrive late are stopped on the spot.
 * `close()` (and any reopen) invalidates the generation, stops the reader, clears the polling
 * timer and stops the tracks — so nothing from a closed sheet can touch the next one.
 *
 * The dependencies are injected so the lifecycle can be tested with controlled promises and
 * fake streams, without a device or a browser.
 */
export interface StreamLike {
  getTracks(): { stop(): void }[]
}
export interface ReaderLike {
  stop(): void
}
export interface VideoLike {
  srcObject: unknown
  play(): Promise<void>
}
export interface DetectedBarcode {
  rawValue?: string
}
export interface DetectorLike {
  detect(source: VideoLike): Promise<DetectedBarcode[]>
}
export type DetectorCtor = new (opts?: { formats?: string[] }) => DetectorLike

export interface CameraScanDeps {
  /** The <video> the frames are read from. */
  getVideo: () => VideoLike | null
  getUserMedia: () => Promise<StreamLike>
  /** `window.BarcodeDetector` when the browser has one. */
  getDetector: () => DetectorCtor | undefined
  /**
   * Start the zxing fallback on the video. `emit` is already fenced to the calling
   * generation, so a reader that lives on after a close cannot deliver a code.
   */
  startZxing: (video: VideoLike, emit: (code: string) => void) => Promise<ReaderLike>
  onCode: (code: string) => void
  onError: (kind: 'camera' | 'reader') => void
  /** The stream now feeding the video, or null once it has stopped. */
  onStream: (stream: StreamLike | null) => void
  pollMs?: number
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (id: number) => void
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']

export class CameraScanController {
  private gen = 0
  private active = false
  private timer: number | null = null
  private reader: ReaderLike | null = null
  private stream: StreamLike | null = null
  private readonly deps: CameraScanDeps

  constructor(deps: CameraScanDeps) {
    this.deps = deps
  }

  /** Whether this session is still the current one. */
  isActive(): boolean {
    return this.active
  }

  /** Begin (or restart) reading. Any previous session becomes stale at once. */
  open(): void {
    this.active = true
    const g = ++this.gen
    void this.run(g)
  }

  /** Invalidate the session and release everything it owns. Idempotent. */
  close(): void {
    this.active = false
    this.gen++
    this.teardown()
  }

  private isCurrent(g: number): boolean {
    return this.active && g === this.gen
  }

  private setTimer(fn: () => void, ms: number): number {
    return (this.deps.setTimer ?? ((f, m) => globalThis.setTimeout(f, m)))(fn, ms)
  }

  private clearTimer(id: number): void {
    ;(this.deps.clearTimer ?? ((x) => globalThis.clearTimeout(x)))(id)
  }

  private teardown(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
    this.reader?.stop()
    this.reader = null
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    if (this.stream) {
      this.stream = null
      this.deps.onStream(null)
    }
  }

  private async run(g: number): Promise<void> {
    let stream: StreamLike
    try {
      stream = await this.deps.getUserMedia()
    } catch {
      if (this.isCurrent(g)) this.deps.onError('camera')
      return
    }
    // A stream that arrives after close/reopen is stopped here, BEFORE it can be shared.
    if (!this.isCurrent(g)) {
      for (const track of stream.getTracks()) track.stop()
      return
    }
    this.stream = stream
    this.deps.onStream(stream)

    const video = this.deps.getVideo()
    if (!video) {
      this.teardown()
      return
    }
    try {
      video.srcObject = stream
      await video.play()
    } catch {
      /* a video that will not play is not fatal: the manual box stays */
    }
    if (!this.isCurrent(g)) return

    const Detector = this.deps.getDetector()
    if (Detector) {
      const detector = new Detector({ formats: FORMATS })
      const tick = async () => {
        if (!this.isCurrent(g)) return
        let hits: DetectedBarcode[] = []
        try {
          hits = await detector.detect(video)
        } catch {
          /* a frame that cannot be read is not an error worth showing */
        }
        if (!this.isCurrent(g)) return
        if (hits[0]?.rawValue) this.deps.onCode(hits[0].rawValue)
        if (!this.isCurrent(g)) return
        this.timer = this.setTimer(() => void tick(), this.deps.pollMs ?? 250)
      }
      this.reader = {
        stop: () => {
          if (this.timer !== null) {
            this.clearTimer(this.timer)
            this.timer = null
          }
        },
      }
      void tick()
      return
    }

    try {
      const controls = await this.deps.startZxing(video, (code) => {
        if (this.isCurrent(g)) this.deps.onCode(code)
      })
      if (!this.isCurrent(g)) {
        controls.stop()
        return
      }
      this.reader = controls
    } catch {
      if (this.isCurrent(g)) this.deps.onError('reader')
    }
  }
}
