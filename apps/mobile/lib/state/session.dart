import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config.dart';

/// Authentication and endpoint configuration, persisted with shared_preferences.
class SessionStore extends ChangeNotifier {
  SessionStore({SharedPreferences? prefs}) : _prefsOverride = prefs;

  static const String _prefApiKey = 'lodestar.api_key';
  static const String _prefGatewayUrl = 'lodestar.gateway_url';
  static const String _prefAiopsUrl = 'lodestar.aiops_url';

  /// Every Lodestar API key starts with this prefix.
  static const String apiKeyPrefix = 'pg_';

  final SharedPreferences? _prefsOverride;
  SharedPreferences? _prefs;
  String? _apiKey;
  String? _gatewayUrl;
  String? _aiopsUrl;

  /// Returns null when [value] is a usable API key, otherwise the problem.
  static String? validateApiKey(String? value) {
    final String key = (value ?? '').trim();
    if (key.isEmpty) {
      return 'API key is required.';
    }
    if (!key.startsWith(apiKeyPrefix)) {
      return 'API key must start with "$apiKeyPrefix".';
    }
    return null;
  }

  /// Hydrates the session from disk. Call once during bootstrap.
  Future<void> load() async {
    final SharedPreferences prefs = _prefsOverride ?? await SharedPreferences.getInstance();
    _prefs = prefs;
    _apiKey = prefs.getString(_prefApiKey);
    _gatewayUrl = prefs.getString(_prefGatewayUrl);
    _aiopsUrl = prefs.getString(_prefAiopsUrl);
    notifyListeners();
  }

  String? get apiKey => _apiKey;

  bool get signedIn => validateApiKey(_apiKey) == null;

  /// Custom endpoints when overridden, null when running on defaults.
  String? get customGatewayUrl => _gatewayUrl;
  String? get customAiopsUrl => _aiopsUrl;

  String get gatewayBaseUrl => _gatewayUrl ?? AppConfig.defaultGatewayBaseUrl;
  String get aiopsBaseUrl => _aiopsUrl ?? AppConfig.defaultAiopsBaseUrl;

  AppConfig get config =>
      AppConfig(gatewayBaseUrl: gatewayBaseUrl, aiopsBaseUrl: aiopsBaseUrl);

  /// Persists [rawKey] when it passes validation; returns success.
  Future<bool> signIn(String rawKey) async {
    final String key = rawKey.trim();
    if (validateApiKey(key) != null) {
      return false;
    }
    _apiKey = key;
    await _persist(_prefApiKey, key);
    notifyListeners();
    return true;
  }

  /// Clears the stored API key (endpoint settings are kept).
  Future<void> signOut() async {
    if (_apiKey == null) {
      return;
    }
    _apiKey = null;
    final SharedPreferences? prefs = _prefs;
    if (prefs != null) {
      await prefs.remove(_prefApiKey);
    }
    notifyListeners();
  }

  /// Persists a gateway base URL; returns false when [raw] is invalid.
  Future<bool> setGatewayBaseUrl(String raw) async {
    final String? normalized = AppConfig.normalizeBaseUrl(raw);
    if (normalized == null) {
      return false;
    }
    if (normalized == _gatewayUrl) {
      return true;
    }
    _gatewayUrl = normalized;
    await _persist(_prefGatewayUrl, normalized);
    notifyListeners();
    return true;
  }

  /// Persists an AIOps base URL; returns false when [raw] is invalid.
  Future<bool> setAiopsBaseUrl(String raw) async {
    final String? normalized = AppConfig.normalizeBaseUrl(raw);
    if (normalized == null) {
      return false;
    }
    if (normalized == _aiopsUrl) {
      return true;
    }
    _aiopsUrl = normalized;
    await _persist(_prefAiopsUrl, normalized);
    notifyListeners();
    return true;
  }

  Future<void> _persist(String key, String value) async {
    final SharedPreferences prefs = _prefs ?? await SharedPreferences.getInstance();
    _prefs = prefs;
    await prefs.setString(key, value);
  }
}
