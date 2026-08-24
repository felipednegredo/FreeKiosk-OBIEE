package com.freekiosk

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * CrashLog - persists the reason a FreeKiosk process died.
 *
 * A kiosk normally runs unattended and with no PC attached, so a crash that only
 * reaches logcat is invisible in the field: the app just "closes". This records
 * both native (Java/Kotlin) and JS fatal errors to a file inside the app's own
 * storage, which Settings -> Advanced can display on the device itself.
 *
 * The handler chains to the previously installed one, so crash behaviour is
 * unchanged - we only write down what happened before the process goes away.
 */
object CrashLog {
    private const val TAG = "CrashLog"
    private const val FILE_NAME = "freekiosk-crash.log"

    /** Keep the file small enough to read in a dialog; older entries are dropped. */
    private const val MAX_BYTES = 128 * 1024

    private fun logFile(context: Context): File =
        File(context.filesDir, FILE_NAME)

    /** Install the process-wide uncaught exception handler. Call once, from Application.onCreate(). */
    @JvmStatic
    fun install(context: Context) {
        val appContext = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                append(
                    appContext,
                    "NATIVE CRASH (thread: ${thread.name})",
                    Log.getStackTraceString(throwable)
                )
            } catch (t: Throwable) {
                // Never let the logger hide the crash it is reporting
                Log.e(TAG, "Failed to persist crash: ${t.message}")
            }
            previous?.uncaughtException(thread, throwable)
        }

        Log.i(TAG, "Crash handler installed -> ${logFile(appContext).absolutePath}")
    }

    /** Append an entry. Used by the handler above and by the JS global error handler. */
    @JvmStatic
    @Synchronized
    fun append(context: Context, title: String, details: String) {
        val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        val entry = buildString {
            append("\n===== $timestamp - $title =====\n")
            append("app: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            append(" | android: ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})")
            append(" | device: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}\n")
            append(details)
            append("\n")
        }

        Log.e(TAG, entry)

        val file = logFile(context)
        file.appendText(entry)

        // Trim from the front once the file grows past the cap
        if (file.length() > MAX_BYTES) {
            val kept = file.readText().takeLast(MAX_BYTES / 2)
            file.writeText("[... older entries trimmed ...]\n$kept")
        }
    }

    /** Full log contents, or an empty string when nothing has been recorded. */
    @JvmStatic
    fun read(context: Context): String {
        val file = logFile(context)
        return if (file.exists()) file.readText() else ""
    }

    @JvmStatic
    fun clear(context: Context) {
        logFile(context).delete()
    }
}
