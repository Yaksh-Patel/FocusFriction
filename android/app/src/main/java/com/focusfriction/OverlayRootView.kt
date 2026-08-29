package com.focusfriction

import android.content.Context
import android.util.AttributeSet
import android.view.KeyEvent
import android.widget.FrameLayout

/**
 * OverlayRootView — root of the pause window.
 *
 * Overrides dispatchKeyEvent rather than using setOnKeyListener. A key listener
 * only fires when that specific view holds focus, so BACK leaked through to the
 * app underneath as soon as focus moved to the keypad or a button — which let the
 * paused app open. dispatchKeyEvent sees every key routed to the window.
 */
class OverlayRootView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : FrameLayout(context, attrs, defStyleAttr) {

    /** Invoked on BACK. Returning is not optional — the event is always consumed. */
    var onBackPressed: (() -> Unit)? = null

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) onBackPressed?.invoke()
            return true   // consume both DOWN and UP so nothing reaches the app
        }
        return super.dispatchKeyEvent(event)
    }
}
