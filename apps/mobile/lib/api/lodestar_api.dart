import 'dart:convert';

import 'package:dio/dio.dart';

import '../config.dart';
import '../models/models.dart';

/// Typed error surfaced by [LodestarApi] for every failed request.
class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode, this.cause});

  final String message;
  final int? statusCode;
  final Object? cause;

  /// Maps a raw [DioException] onto a user-presentable message.
  factory ApiException.fromDio(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return ApiException('Request timed out after 5 seconds.', cause: error);
      case DioExceptionType.connectionError:
        return ApiException(
          'Could not reach the server. Check the URL and your network.',
          cause: error,
        );
      case DioExceptionType.badResponse:
        final int? status = error.response?.statusCode;
        final String detail;
        if (status == 401 || status == 403) {
          detail = 'API key rejected by the server.';
        } else if (status == 404) {
          detail = 'Endpoint not found. Verify the base URL.';
        } else if (status != null && status >= 500) {
          detail = 'Service unavailable (HTTP $status).';
        } else {
          detail = 'Request failed (HTTP ${status ?? 'unknown'}).';
        }
        return ApiException(detail, statusCode: status, cause: error);
      case DioExceptionType.badCertificate:
        return ApiException('Server certificate could not be trusted.', cause: error);
      case DioExceptionType.cancel:
        return ApiException('Request cancelled.', cause: error);
      case DioExceptionType.unknown:
        return ApiException(error.message ?? 'Unexpected network error.', cause: error);
    }
  }

  @override
  String toString() =>
      statusCode == null ? 'ApiException: $message' : 'ApiException($statusCode): $message';
}

/// HTTP client for the Lodestar gateway (:3100) and AIOps engine (:3200).
///
/// A single instance is shared through the provider tree; call [configure]
/// when the session endpoints or API key change and [dispose] at teardown.
class LodestarApi {
  LodestarApi({required AppConfig config, String? apiKey})
      : _config = config,
        _apiKey = apiKey {
    _gateway = _buildDio(config.gatewayBaseUrl);
    _aiops = _buildDio(config.aiopsBaseUrl);
  }

  static const Duration _timeout = Duration(seconds: 5);

  AppConfig _config;
  String? _apiKey;
  late Dio _gateway;
  late Dio _aiops;

  AppConfig get config => _config;
  String? get apiKey => _apiKey;

  Dio _buildDio(String baseUrl) {
    final Dio dio = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: _timeout,
        sendTimeout: _timeout,
        receiveTimeout: _timeout,
        responseType: ResponseType.json,
        validateStatus: (int? code) => code != null && code >= 200 && code < 300,
      ),
    );
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (RequestOptions options, RequestInterceptorHandler handler) {
          final String? key = _apiKey;
          if (key != null && key.isNotEmpty) {
            options.headers['x-api-key'] = key;
          }
          handler.next(options);
        },
      ),
    );
    return dio;
  }

  /// Applies the latest session configuration (base URLs + API key).
  void configure({required AppConfig config, required String? apiKey}) {
    _apiKey = apiKey;
    final bool gatewayMoved = config.gatewayBaseUrl != _config.gatewayBaseUrl;
    final bool aiopsMoved = config.aiopsBaseUrl != _config.aiopsBaseUrl;
    _config = config;
    if (gatewayMoved) {
      _gateway.close(force: true);
      _gateway = _buildDio(config.gatewayBaseUrl);
    }
    if (aiopsMoved) {
      _aiops.close(force: true);
      _aiops = _buildDio(config.aiopsBaseUrl);
    }
  }

  /// Gateway fleet counters (`GET /v1/stats`).
  Future<GatewayStats> stats() async {
    final Map<String, dynamic> body = await _getJson(_gateway, '/v1/stats');
    return GatewayStats.fromJson(body);
  }

  /// Metric time series (`GET /v1/query/metrics`).
  Future<List<MetricSeries>> metricSeries({
    required List<String> names,
    required String range,
    int points = 60,
  }) async {
    final Map<String, dynamic> body = await _getJson(
      _gateway,
      '/v1/query/metrics',
      query: <String, dynamic>{
        'names': names.join(','),
        'range': range,
        'points': points,
      },
    );
    return parseJsonList(body['series'], MetricSeries.fromJson);
  }

  /// Structured logs (`GET /v1/logs`), optionally filtered.
  Future<LogsPage> logs({int limit = 100, String? level, String? service, String? q}) async {
    final Map<String, dynamic> query = <String, dynamic>{
      'limit': limit,
      if (level != null && level.isNotEmpty) 'level': level,
      if (service != null && service.isNotEmpty) 'service': service,
      if (q != null && q.isNotEmpty) 'q': q,
    };
    final Map<String, dynamic> body = await _getJson(_gateway, '/v1/logs', query: query);
    return LogsPage.fromJson(body);
  }

  /// Anomaly / forecast / health bundle (`GET /v1/insights` on the AIOps engine).
  Future<InsightBundle> insights() async {
    final Map<String, dynamic> body = await _getJson(_aiops, '/v1/insights');
    return InsightBundle.fromJson(body);
  }

  /// Gateway reachability probe (`GET /v1/health`); throws on non-ok status.
  Future<void> health() async {
    final Map<String, dynamic> body = await _getJson(_gateway, '/v1/health');
    final Object? status = body['status'];
    if (status?.toString() != 'ok') {
      throw ApiException('Gateway reported status "${status?.toString() ?? 'unknown'}".');
    }
  }

  Future<Map<String, dynamic>> _getJson(
    Dio dio,
    String path, {
    Map<String, dynamic>? query,
  }) async {
    try {
      final Response<dynamic> response = await dio.get<dynamic>(path, queryParameters: query);
      final dynamic data = response.data;
      if (data is Map<String, dynamic>) {
        return data;
      }
      if (data is String && data.isNotEmpty) {
        final dynamic decoded = jsonDecode(data);
        if (decoded is Map<String, dynamic>) {
          return decoded;
        }
      }
      throw const ApiException('Unexpected response shape from server.');
    } on DioException catch (error) {
      throw ApiException.fromDio(error);
    }
  }

  /// Closes both HTTP clients.
  void dispose() {
    _gateway.close(force: true);
    _aiops.close(force: true);
  }
}
