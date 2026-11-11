//! rustls-platform-verifier verifies HTTPS certificates through Android's trust manager and
//! panics ("Expect rustls-platform-verifier to be initialized") until it has been handed the
//! JVM and app context. reqwest (GitHub sign-in) and gix's HTTP transport (clone, fetch, push)
//! both go through it, so this runs once at startup, before any request.

use jni::objects::JObject;
use jni::JavaVM;

pub fn init() -> anyhow::Result<()> {
    let ctx = ndk_context::android_context();
    // SAFETY: ndk-context holds the live JavaVM pointer Tauri's Android glue registered.
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) };
    vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
        // SAFETY: ndk-context's context is a global reference that outlives this call; the
        // verifier takes its own global reference to it and never frees ours.
        let context = unsafe { JObject::from_raw(env, ctx.context().cast()) };
        rustls_platform_verifier::android::init_with_env(env, context)
    })?;
    Ok(())
}
