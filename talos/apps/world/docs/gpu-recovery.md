# GPU loss and startup recovery

A null adapter is a browser-level startup failure, not a route-search error. The reported sequence was a frozen view during planning, followed by persistent null adapters after reload. No GPU crash log was captured, so the precise cause remains unconfirmed.

Animated route overlays keep the full scene rendering even while the camera is stationary. The viewer now limits outstanding rendered frames to two using queue completion promises, instead of continuing to submit when the GPU falls behind. This bounds submission pressure; it does not prevent a single expensive frame from triggering a driver failure.

Startup tries the preferred high-performance adapter, then the browser default if the first returns null. It does not loop on allocation failures. A failed viewer constructor destroys its device. Device loss stops and destroys the viewer, removes its overlays, and exposes a manual Retry viewer action. A device lost during initialization cannot later be installed as the active viewer.

If retries still return null, fully exit and reopen the affected browser. Page reload cannot repair a browser GPU process that remains unavailable. Capture the device-loss console message and browser GPU diagnostics if it recurs; do not assume that a successful restart establishes the root cause.

Validation covers fallback selection, bounded failure, allocation-error propagation and outstanding-frame release after completion/rejection. Type checking and a development build also pass. The user's freeze has not been reproduced in a live planning session.
