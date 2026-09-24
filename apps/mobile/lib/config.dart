import 'package:flutter/foundation.dart';

/// Base URLs for the two backend services the app talks to.
///
/// Defaults target the Android emulator, where `10.0.2.2` is an alias for the
/// host machine's loopback interface. Both values are overridable at runtime
/// from the settings screen and persisted via [SessionStore].
@immutable
class AppConfig {
  const AppConfig({
    this.gatewayBaseUrl = defaultGatewayBaseUrl,
    this.aiopsBaseUrl = defaultAiopsBaseUrl,
  });

  /// Go ingest gateway (`:3100`).
  static const String defaultGatewayBaseUrl = 'http://10.0.2.2:3100';

  /// Python AIOps engine (`:3200`).
  static const String defaultAiopsBaseUrl = 'http://10.0.2.2:3200';

  final String gatewayBaseUrl;
  final String aiopsBaseUrl;

  AppConfig copyWith({String? gatewayBaseUrl, String? aiopsBaseUrl}) {
    return AppConfig(
      gatewayBaseUrl: gatewayBaseUrl ?? this.gatewayBaseUrl,
      aiopsBaseUrl: aiopsBaseUrl ?? this.aiopsBaseUrl,
    );
  }

  /// Normalizes a user supplied base URL by trimming whitespace and trailing
  /// slashes. Returns null when the value is not a usable http(s) origin.
  static String? normalizeBaseUrl(String raw) {
    String value = raw.trim();
    while (value.endsWith('/')) {
      value = value.substring(0, value.length - 1);
    }
    if (value.isEmpty) {
      return null;
    }
    final Uri? uri = Uri.tryParse(value);
    if (uri == null ||
        !uri.hasScheme ||
        (uri.scheme != 'http' && uri.scheme != 'https') ||
        uri.host.isEmpty) {
      return null;
    }
    return value;
  }

  @override
  bool operator ==(Object other) =>
      other is AppConfig &&
      other.gatewayBaseUrl == gatewayBaseUrl &&
      other.aiopsBaseUrl == aiopsBaseUrl;

  @override
  int get hashCode => Object.hash(gatewayBaseUrl, aiopsBaseUrl);

  @override
  String toString() => 'AppConfig(gateway: $gatewayBaseUrl, aiops: $aiopsBaseUrl)';
}

/// Named routes of the app.
abstract final class LodestarRoutes {
  static const String login = '/login';
  static const String home = '/home';
  static const String incidents = '/incidents';
  static const String insights = '/insights';
  static const String settings = '/settings';
}
