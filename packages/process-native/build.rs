fn main() {
  napi_build::setup();
  println!("cargo::rerun-if-changed=build.rs");
  if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
    println!("cargo::rerun-if-changed=src/unix/macos_socket.c");
    cc::Build::new()
      .file("src/unix/macos_socket.c")
      .warnings_into_errors(true)
      .compile("odt_macos_socket");
  }
}
