import {describe, it, expect, vi, beforeEach} from "vitest"

const posthogMock = {
    __loaded: false,
    capture: vi.fn(),
    captureException: vi.fn(),
    opt_out_capturing: vi.fn(),
    reset: vi.fn(),
}

vi.mock("posthog-js", () => ({
    default: posthogMock,
}))

vi.mock("../composables/usePosthog", () => ({
    initPostHogForSetup: vi.fn(async () => {
        posthogMock.__loaded = true
    }),
}))

describe("posthog queue", () => {
    beforeEach(() => {
        posthogMock.__loaded = false
        posthogMock.capture.mockClear()
        posthogMock.captureException.mockClear()
        posthogMock.opt_out_capturing.mockClear()
        posthogMock.reset.mockClear()
        vi.resetModules()
    })

    it("queues events until initialized and flushes after init", async () => {
        const {capturePosthogEvent, initPosthogIfEnabled} = await import("./posthog")

        capturePosthogEvent(
            {isUiAnonymousUsageEnabled: true},
            "test_event",
            {foo: "bar"},
        )

        expect(posthogMock.capture).not.toHaveBeenCalled()

        await initPosthogIfEnabled({isUiAnonymousUsageEnabled: true})

        expect(posthogMock.capture).toHaveBeenCalledTimes(1)
        expect(posthogMock.capture).toHaveBeenCalledWith("test_event", {foo: "bar"})
    })

    it("opts out and resets when disabled after init", async () => {
        const {capturePosthogEvent, initPosthogIfEnabled} = await import("./posthog")

        capturePosthogEvent(
            {isUiAnonymousUsageEnabled: true},
            "test_event",
            {foo: "bar"},
        )

        await initPosthogIfEnabled({isUiAnonymousUsageEnabled: true})

        capturePosthogEvent(
            {isUiAnonymousUsageEnabled: false},
            "test_event_2",
            {foo: "baz"},
        )

        expect(posthogMock.opt_out_capturing).toHaveBeenCalled()
        expect(posthogMock.reset).toHaveBeenCalled()
    })

    it("captures exceptions when enabled and skips when disabled", async () => {
        const {capturePosthogException, initPosthogIfEnabled} = await import("./posthog")

        await initPosthogIfEnabled({isUiAnonymousUsageEnabled: true})

        const error = new Error("boom")
        capturePosthogException({isUiAnonymousUsageEnabled: true}, error, {handler: "vue"})
        await new Promise((resolve) => setTimeout(resolve))

        expect(posthogMock.captureException).toHaveBeenCalledTimes(1)
        expect(posthogMock.captureException).toHaveBeenCalledWith(error, {handler: "vue"})

        capturePosthogException({isUiAnonymousUsageEnabled: false}, new Error("nope"))
        await new Promise((resolve) => setTimeout(resolve))

        expect(posthogMock.captureException).toHaveBeenCalledTimes(1)
    })

    it("captures a repeated exception once per minute", async () => {
        const {capturePosthogException, initPosthogIfEnabled} = await import("./posthog")
        const configs = {isUiAnonymousUsageEnabled: true}
        const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000)

        await initPosthogIfEnabled(configs)

        for (let i = 0; i < 5; i++) {
            capturePosthogException(configs, new Error("render loop"), {handler: "vue", info: "render function"})
        }
        capturePosthogException(configs, new Error("render loop"), {handler: "vue", info: "watcher callback"})
        await new Promise((resolve) => setTimeout(resolve))

        expect(posthogMock.captureException).toHaveBeenCalledTimes(2)

        now.mockReturnValue(1_000_000 + 61_000)
        capturePosthogException(configs, new Error("render loop"), {handler: "vue", info: "render function"})
        await new Promise((resolve) => setTimeout(resolve))

        expect(posthogMock.captureException).toHaveBeenCalledTimes(3)
        now.mockRestore()
    })

    it("forwards Vue errors with the handler and the Vue info", async () => {
        const {createPosthogVueErrorHandler, initPosthogIfEnabled} = await import("./posthog")
        const configs = {isUiAnonymousUsageEnabled: true}
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

        await initPosthogIfEnabled(configs)

        const error = new Error("component crashed")
        createPosthogVueErrorHandler(() => configs)(error, null, "render function")
        await new Promise((resolve) => setTimeout(resolve))

        expect(consoleError).toHaveBeenCalledWith(error, "render function")
        expect(posthogMock.captureException).toHaveBeenCalledWith(error, {handler: "vue", info: "render function"})
        consoleError.mockRestore()
    })
})
