import 'package:intl/intl.dart';

final NumberFormat _compact = NumberFormat.compact();
final NumberFormat _count = NumberFormat.decimalPattern();
final DateFormat _clock = DateFormat.Hms();

/// Compact metric formatting for KPI tiles and chart axes (1234 -> '1.2K').
String formatCompact(num value) => _compact.format(value);

/// Full decimal formatting for counts (agents, series).
String formatCount(num value) => _count.format(value);

/// Rates at or below 1 are treated as fractions and rendered as percentages.
String formatRatePercent(double value) {
  final double pct = value <= 1 ? value * 100 : value;
  return '${pct.toStringAsFixed(pct >= 10 ? 1 : 2)}%';
}

/// Millisecond latencies: one decimal below 100ms, integers above.
String formatLatency(double ms) => ms >= 100 ? ms.toStringAsFixed(0) : ms.toStringAsFixed(1);

/// Relative time: 'just now', '5m ago', '3h ago', '2d ago'.
String formatRelativeTime(DateTime when) {
  final Duration diff = DateTime.now().difference(when);
  if (diff.inSeconds < 45) {
    return 'just now';
  }
  if (diff.inMinutes < 60) {
    return '${diff.inMinutes}m ago';
  }
  if (diff.inHours < 24) {
    return '${diff.inHours}h ago';
  }
  return '${diff.inDays}d ago';
}

/// Compact uptime: 90061 -> '1d 1h'; short spans fall back to minutes.
String formatUptime(int seconds) {
  final Duration uptime = Duration(seconds: seconds);
  final int days = uptime.inDays;
  final int hours = uptime.inHours - days * 24;
  final int minutes = uptime.inMinutes - uptime.inHours * 60;
  if (days > 0) {
    return '${days}d ${hours}h';
  }
  if (hours > 0) {
    return '${hours}h ${minutes}m';
  }
  return '${minutes}m';
}

/// Wall-clock time used for 'last updated' labels.
String formatClock(DateTime when) => _clock.format(when);

/// Masks an API key for display, keeping the first 7 and last 4 characters.
String maskApiKey(String key) {
  if (key.length <= 11) {
    return '*' * key.length;
  }
  final String head = key.substring(0, 7);
  final String tail = key.substring(key.length - 4);
  final String middle = '*' * (key.length - 11);
  return '$head$middle$tail';
}

/// Clamps a value into the 0..1 interval (confidence normalization).
double clamp01(double value) {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
