import 'package:flutter/foundation.dart';

/// Health status derived from AIOps service scores.
enum HealthStatus { healthy, degraded, critical }

/// Maps a 0..100 service score onto the status ramp.
HealthStatus healthStatusFromScore(double score) {
  if (score >= 80) {
    return HealthStatus.healthy;
  }
  if (score >= 50) {
    return HealthStatus.degraded;
  }
  return HealthStatus.critical;
}

/// Maps a backend status label to [HealthStatus]; null when unrecognized.
HealthStatus? healthStatusFromName(String? name) {
  switch (name) {
    case 'healthy':
    case 'ok':
      return HealthStatus.healthy;
    case 'degraded':
    case 'warn':
    case 'warning':
      return HealthStatus.degraded;
    case 'critical':
    case 'crit':
      return HealthStatus.critical;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tolerant JSON readers (the backend is polyglot; keys may be snake or camel).
// ---------------------------------------------------------------------------

String? _readString(Object? raw) {
  if (raw == null) {
    return null;
  }
  return raw is String ? raw : raw.toString();
}

int? _readInt(Object? raw) {
  if (raw is num) {
    return raw.toInt();
  }
  return raw is String ? int.tryParse(raw) : null;
}

double? _readDouble(Object? raw) {
  if (raw is num) {
    return raw.toDouble();
  }
  return raw is String ? double.tryParse(raw) : null;
}

DateTime? _readDateTime(Object? raw) {
  if (raw is num) {
    return DateTime.fromMillisecondsSinceEpoch(raw.toInt());
  }
  if (raw is String) {
    final DateTime? parsed = DateTime.tryParse(raw);
    if (parsed != null) {
      return parsed;
    }
    final int? millis = int.tryParse(raw);
    if (millis != null) {
      return DateTime.fromMillisecondsSinceEpoch(millis);
    }
  }
  return null;
}

Map<String, String> _readTags(Object? raw) {
  if (raw is Map) {
    return <String, String>{
      for (final entry in raw.entries) entry.key.toString(): entry.value.toString(),
    };
  }
  return const <String, String>{};
}

Map<String, dynamic> _readMap(Object? raw) {
  return raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
}

Object? _firstOf(Map<String, dynamic> json, List<String> keys) {
  for (final String key in keys) {
    final Object? value = json[key];
    if (value != null) {
      return value;
    }
  }
  return null;
}

/// Parses a JSON array of objects, skipping malformed entries.
List<T> parseJsonList<T>(Object? raw, T Function(Map<String, dynamic>) fromJson) {
  if (raw is List) {
    return <T>[
      for (final Object? item in raw)
        if (item is Map<String, dynamic>) fromJson(item),
    ];
  }
  return const <T>[];
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/// A single metric sample: epoch milliseconds plus a numeric value.
@immutable
class MetricPoint {
  const MetricPoint({required this.ts, required this.value});

  factory MetricPoint.fromJson(Map<String, dynamic> json) {
    return MetricPoint(
      ts: _readInt(json['ts']) ?? 0,
      value: _readDouble(json['value']) ?? 0,
    );
  }

  /// Epoch milliseconds.
  final int ts;
  final double value;

  Map<String, dynamic> toJson() => <String, dynamic>{'ts': ts, 'value': value};

  @override
  bool operator ==(Object other) =>
      other is MetricPoint && other.ts == ts && other.value == value;

  @override
  int get hashCode => Object.hash(ts, value);
}

/// A named metric time series with free-form tags (e.g. service=api).
@immutable
class MetricSeries {
  const MetricSeries({
    required this.name,
    this.tags = const <String, String>{},
    this.points = const <MetricPoint>[],
  });

  factory MetricSeries.fromJson(Map<String, dynamic> json) {
    return MetricSeries(
      name: _readString(json['name']) ?? 'unknown',
      tags: _readTags(json['tags']),
      points: parseJsonList(json['points'], MetricPoint.fromJson),
    );
  }

  final String name;
  final Map<String, String> tags;
  final List<MetricPoint> points;

  /// Convenience accessor for the conventional `service` tag.
  String? get service => tags['service'];

  /// Last sample value, or null when the series is empty.
  double? get latestValue => points.isEmpty ? null : points.last.value;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'name': name,
        'tags': tags,
        'points': <Map<String, dynamic>>[for (final MetricPoint point in points) point.toJson()],
      };

  @override
  bool operator ==(Object other) =>
      other is MetricSeries &&
      other.name == name &&
      mapEquals(other.tags, tags) &&
      listEquals(other.points, points);

  @override
  int get hashCode => Object.hash(name, tags.length, points.length);
}

/// One structured log line from the gateway query API.
@immutable
class LogEntry {
  const LogEntry({
    required this.level,
    required this.service,
    required this.message,
    required this.ts,
  });

  factory LogEntry.fromJson(Map<String, dynamic> json) {
    return LogEntry(
      level: _readString(json['level']) ?? 'info',
      service: _readString(json['service']) ?? 'unknown',
      message: _readString(json['message']) ?? '',
      ts: _readInt(json['ts']) ?? 0,
    );
  }

  final String level;
  final String service;
  final String message;

  /// Epoch milliseconds.
  final int ts;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'level': level,
        'service': service,
        'message': message,
        'ts': ts,
      };

  @override
  bool operator ==(Object other) =>
      other is LogEntry &&
      other.level == level &&
      other.service == service &&
      other.message == message &&
      other.ts == ts;

  @override
  int get hashCode => Object.hash(level, service, message, ts);
}

/// Page result of `GET /v1/logs`.
@immutable
class LogsPage {
  const LogsPage({required this.logs, required this.total});

  factory LogsPage.fromJson(Map<String, dynamic> json) {
    return LogsPage(
      logs: parseJsonList(json['logs'], LogEntry.fromJson),
      total: _readInt(json['total']) ?? 0,
    );
  }

  final List<LogEntry> logs;
  final int total;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'logs': <Map<String, dynamic>>[for (final LogEntry log in logs) log.toJson()],
        'total': total,
      };

  @override
  bool operator ==(Object other) =>
      other is LogsPage && other.total == total && listEquals(other.logs, logs);

  @override
  int get hashCode => Object.hash(total, logs.length);
}

/// Fleet counters from `GET /v1/stats`.
@immutable
class GatewayStats {
  const GatewayStats({
    required this.requestsPerSecond,
    required this.seriesActive,
    required this.logsPerMinute,
    required this.agentsConnected,
    required this.uptimeSeconds,
  });

  factory GatewayStats.fromJson(Map<String, dynamic> json) {
    return GatewayStats(
      requestsPerSecond:
          _readInt(_firstOf(json, const <String>['requests_per_second', 'requestsPerSecond'])) ?? 0,
      seriesActive: _readInt(_firstOf(json, const <String>['series_active', 'seriesActive'])) ?? 0,
      logsPerMinute:
          _readInt(_firstOf(json, const <String>['logs_per_minute', 'logsPerMinute'])) ?? 0,
      agentsConnected:
          _readInt(_firstOf(json, const <String>['agents_connected', 'agentsConnected'])) ?? 0,
      uptimeSeconds:
          _readInt(_firstOf(json, const <String>['uptime_seconds', 'uptimeSeconds'])) ?? 0,
    );
  }

  final int requestsPerSecond;
  final int seriesActive;
  final int logsPerMinute;
  final int agentsConnected;
  final int uptimeSeconds;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'requests_per_second': requestsPerSecond,
        'series_active': seriesActive,
        'logs_per_minute': logsPerMinute,
        'agents_connected': agentsConnected,
        'uptime_seconds': uptimeSeconds,
      };

  @override
  bool operator ==(Object other) =>
      other is GatewayStats &&
      other.requestsPerSecond == requestsPerSecond &&
      other.seriesActive == seriesActive &&
      other.logsPerMinute == logsPerMinute &&
      other.agentsConnected == agentsConnected &&
      other.uptimeSeconds == uptimeSeconds;

  @override
  int get hashCode => Object.hash(
        requestsPerSecond,
        seriesActive,
        logsPerMinute,
        agentsConnected,
        uptimeSeconds,
      );
}

/// An open anomaly raised by the AIOps engine.
@immutable
class Anomaly {
  const Anomaly({
    required this.id,
    required this.series,
    required this.service,
    required this.metric,
    required this.severity,
    required this.confidence,
    required this.score,
    required this.startedAt,
    required this.message,
    required this.baseline,
    required this.observed,
  });

  factory Anomaly.fromJson(Map<String, dynamic> json) {
    final String series = _readString(json['series']) ?? 'unknown';
    return Anomaly(
      id: _readString(json['id']) ?? '$series@${_readString(json['startedAt']) ?? ''}',
      series: series,
      service: _readString(json['service']) ?? 'unknown',
      metric: _readString(json['metric']) ?? series,
      severity: _readString(json['severity']) ?? 'warning',
      confidence: _readDouble(json['confidence']) ?? 0,
      score: _readDouble(json['score']) ?? 0,
      startedAt: _readDateTime(json['startedAt']) ?? DateTime.now(),
      message: _readString(json['message']) ?? '',
      baseline: _readDouble(json['baseline']) ?? 0,
      observed: _readDouble(json['observed']) ?? 0,
    );
  }

  final String id;
  final String series;
  final String service;
  final String metric;
  final String severity;

  /// Detection confidence in the 0..1 range.
  final double confidence;
  final double score;
  final DateTime startedAt;
  final String message;
  final double baseline;
  final double observed;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'series': series,
        'service': service,
        'metric': metric,
        'severity': severity,
        'confidence': confidence,
        'score': score,
        'startedAt': startedAt.toIso8601String(),
        'message': message,
        'baseline': baseline,
        'observed': observed,
      };

  @override
  bool operator ==(Object other) =>
      other is Anomaly &&
      other.id == id &&
      other.series == series &&
      other.service == service &&
      other.metric == metric &&
      other.severity == severity &&
      other.confidence == confidence &&
      other.score == score &&
      other.startedAt == startedAt &&
      other.message == message &&
      other.baseline == baseline &&
      other.observed == observed;

  @override
  int get hashCode => Object.hash(
        id,
        series,
        service,
        metric,
        severity,
        confidence,
        score,
        startedAt,
        message,
        baseline,
        observed,
      );
}

/// Per-service rollup produced by the AIOps engine.
@immutable
class ServiceHealth {
  const ServiceHealth({
    required this.service,
    required this.score,
    required this.status,
  });

  factory ServiceHealth.fromJson(Map<String, dynamic> json) {
    final double score = _readDouble(json['score']) ?? 0;
    final HealthStatus? byName = healthStatusFromName(_readString(json['status']));
    return ServiceHealth(
      service: _readString(json['service']) ?? 'unknown',
      score: score,
      status: byName ?? healthStatusFromScore(score),
    );
  }

  final String service;
  final double score;
  final HealthStatus status;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'service': service,
        'score': score,
        'status': status.name,
      };

  @override
  bool operator ==(Object other) =>
      other is ServiceHealth &&
      other.service == service &&
      other.score == score &&
      other.status == status;

  @override
  int get hashCode => Object.hash(service, score, status);
}

/// A projected series published by the AIOps engine.
@immutable
class Forecast {
  const Forecast({
    required this.series,
    this.service,
    this.metric,
    this.horizonMinutes,
    this.points = const <MetricPoint>[],
  });

  factory Forecast.fromJson(Map<String, dynamic> json) {
    return Forecast(
      series: _readString(json['series']) ?? _readString(json['name']) ?? 'unknown',
      service: _readString(json['service']),
      metric: _readString(json['metric']),
      horizonMinutes:
          _readInt(_firstOf(json, const <String>['horizon_minutes', 'horizonMinutes'])),
      points: parseJsonList(json['points'], MetricPoint.fromJson),
    );
  }

  final String series;
  final String? service;
  final String? metric;
  final int? horizonMinutes;
  final List<MetricPoint> points;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'series': series,
        if (service != null) 'service': service,
        if (metric != null) 'metric': metric,
        if (horizonMinutes != null) 'horizon_minutes': horizonMinutes,
        'points': <Map<String, dynamic>>[for (final MetricPoint point in points) point.toJson()],
      };

  @override
  bool operator ==(Object other) =>
      other is Forecast &&
      other.series == series &&
      other.service == service &&
      other.metric == metric &&
      other.horizonMinutes == horizonMinutes &&
      listEquals(other.points, points);

  @override
  int get hashCode => Object.hash(series, service, metric, horizonMinutes, points.length);
}

/// Aggregate counters from the AIOps summary block.
@immutable
class InsightSummary {
  const InsightSummary({
    required this.servicesMonitored,
    required this.openAnomalies,
    required this.overallStatus,
  });

  factory InsightSummary.fromJson(Map<String, dynamic> json) {
    return InsightSummary(
      servicesMonitored:
          _readInt(_firstOf(json, const <String>['services_monitored', 'servicesMonitored'])) ?? 0,
      openAnomalies:
          _readInt(_firstOf(json, const <String>['open_anomalies', 'openAnomalies'])) ?? 0,
      overallStatus:
          _readString(_firstOf(json, const <String>['overall_status', 'overallStatus'])) ??
              'unknown',
    );
  }

  final int servicesMonitored;
  final int openAnomalies;
  final String overallStatus;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'services_monitored': servicesMonitored,
        'open_anomalies': openAnomalies,
        'overall_status': overallStatus,
      };

  @override
  bool operator ==(Object other) =>
      other is InsightSummary &&
      other.servicesMonitored == servicesMonitored &&
      other.openAnomalies == openAnomalies &&
      other.overallStatus == overallStatus;

  @override
  int get hashCode => Object.hash(servicesMonitored, openAnomalies, overallStatus);
}

/// Full response of `GET /v1/insights` from the AIOps engine.
@immutable
class InsightBundle {
  const InsightBundle({
    this.anomalies = const <Anomaly>[],
    this.forecasts = const <Forecast>[],
    this.health = const <ServiceHealth>[],
    this.summary = const InsightSummary(
      servicesMonitored: 0,
      openAnomalies: 0,
      overallStatus: 'unknown',
    ),
  });

  factory InsightBundle.fromJson(Map<String, dynamic> json) {
    return InsightBundle(
      anomalies: parseJsonList(json['anomalies'], Anomaly.fromJson),
      forecasts: parseJsonList(json['forecasts'], Forecast.fromJson),
      health: parseJsonList(json['health'], ServiceHealth.fromJson),
      summary: InsightSummary.fromJson(_readMap(json['summary'])),
    );
  }

  final List<Anomaly> anomalies;
  final List<Forecast> forecasts;
  final List<ServiceHealth> health;
  final InsightSummary summary;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'anomalies': <Map<String, dynamic>>[for (final Anomaly anomaly in anomalies) anomaly.toJson()],
        'forecasts': <Map<String, dynamic>>[
          for (final Forecast forecast in forecasts) forecast.toJson(),
        ],
        'health': <Map<String, dynamic>>[for (final ServiceHealth item in health) item.toJson()],
        'summary': summary.toJson(),
      };

  @override
  bool operator ==(Object other) =>
      other is InsightBundle &&
      listEquals(other.anomalies, anomalies) &&
      listEquals(other.forecasts, forecasts) &&
      listEquals(other.health, health) &&
      other.summary == summary;

  @override
  int get hashCode => Object.hash(anomalies.length, forecasts.length, health.length, summary);
}
