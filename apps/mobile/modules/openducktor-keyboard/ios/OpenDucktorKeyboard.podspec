Pod::Spec.new do |s|
  s.name           = 'OpenDucktorKeyboard'
  s.version        = '1.0.0'
  s.summary        = 'Hardware keyboard Enter events for the OpenDucktor mobile app'
  s.description    = 'Reports hardware keyboard Return with its Shift state for a wrapped multiline text input'
  s.license        = 'Apache-2.0'
  s.author         = 'OpenDucktor'
  s.homepage       = 'https://github.com/Maxsky5/openducktor'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Maxsky5/openducktor.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
