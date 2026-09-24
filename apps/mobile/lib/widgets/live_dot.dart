import 'package:flutter/material.dart';

import '../app.dart';

/// Pulsing status dot used in the app bar to signal a live connection.
class LiveDot extends StatefulWidget {
  const LiveDot({super.key, this.color = LodestarColors.emerald, this.size = 10});

  final Color color;
  final double size;

  @override
  State<LiveDot> createState() => _LiveDotState();
}

class _LiveDotState extends State<LiveDot> with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 1600))
        ..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final double size = widget.size;
    return SizedBox(
      width: size * 2.2,
      height: size * 2.2,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (BuildContext context, Widget? child) {
          final double t = _controller.value;
          return Stack(
            alignment: Alignment.center,
            children: <Widget>[
              Opacity(
                opacity: (1 - t) * 0.4,
                child: Container(
                  width: size + size * 1.2 * t,
                  height: size + size * 1.2 * t,
                  decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle),
                ),
              ),
              Container(
                width: size,
                height: size,
                decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle),
              ),
            ],
          );
        },
      ),
    );
  }
}
