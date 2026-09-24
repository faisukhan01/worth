import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../app.dart';

/// Tiny inline time-series chart drawn with a CustomPainter.
class Sparkline extends StatelessWidget {
  const Sparkline({
    super.key,
    required this.values,
    this.color = LodestarColors.emerald,
    this.strokeWidth = 1.6,
  });

  final List<double> values;
  final Color color;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _SparklinePainter(values: values, color: color, strokeWidth: strokeWidth),
    );
  }
}

class _SparklinePainter extends CustomPainter {
  const _SparklinePainter({required this.values, required this.color, required this.strokeWidth});

  final List<double> values;
  final Color color;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty || size.isEmpty) {
      return;
    }
    double lo = values.reduce(math.min);
    double hi = values.reduce(math.max);
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    final double width = size.width;
    final double height = size.height;

    Offset pointAt(int index) {
      final double x = values.length > 1 ? width * index / (values.length - 1) : width / 2;
      final double y = height - ((values[index] - lo) / (hi - lo)) * height;
      return Offset(x, y);
    }

    if (values.length == 1) {
      canvas.drawCircle(pointAt(0), 2, Paint()..color = color);
      return;
    }

    final Path line = Path()..moveTo(pointAt(0).dx, pointAt(0).dy);
    for (int i = 1; i < values.length; i++) {
      line.lineTo(pointAt(i).dx, pointAt(i).dy);
    }

    final Path area = Path.from(line)
      ..lineTo(width, height)
      ..lineTo(0, height)
      ..close();

    canvas.drawPath(area, Paint()..color = color.withOpacity(0.14));
    canvas.drawPath(
      line,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_SparklinePainter oldDelegate) =>
      oldDelegate.color != color ||
      oldDelegate.strokeWidth != strokeWidth ||
      oldDelegate.values.length != values.length;
}
