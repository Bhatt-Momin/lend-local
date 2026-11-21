package expo.modules.apkinstaller

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileNotFoundException
import java.io.InputStream
import java.security.MessageDigest
import java.util.Locale

class ApkInstallerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

  override fun definition() = ModuleDefinition {
    Name("ApkInstaller")

    AsyncFunction("canRequestPackageInstalls") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.packageManager.canRequestPackageInstalls()
      } else {
        true
      }
    }

    AsyncFunction("openInstallPermissionSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      }
    }

    AsyncFunction("installApk") { contentUriString: String ->
      val uri = Uri.parse(contentUriString)
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      val activity = appContext.currentActivity ?: context
      activity.startActivity(intent)
      true
    }

    AsyncFunction("getFileSha256") { uriString: String ->
      if (uriString.isBlank()) {
        throw IllegalArgumentException("URI string cannot be blank")
      }

      val uri = if (uriString.startsWith("content://") || uriString.startsWith("file://")) {
        Uri.parse(uriString)
      } else {
        Uri.fromFile(File(uriString))
      }

      val inputStream: InputStream = context.contentResolver.openInputStream(uri)
        ?: throw FileNotFoundException("Could not open input stream for URI: $uriString")

      inputStream.use { stream ->
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)
        var bytesRead: Int
        while (stream.read(buffer).also { bytesRead = it } != -1) {
          digest.update(buffer, 0, bytesRead)
        }
        val hashBytes = digest.digest()
        val sb = StringBuilder(hashBytes.size * 2)
        for (b in hashBytes) {
          sb.append(String.format(Locale.US, "%02x", b))
        }
        sb.toString().lowercase(Locale.US)
      }
    }
  }
}
