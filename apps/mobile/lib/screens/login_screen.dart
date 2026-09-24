import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/lodestar_api.dart';
import '../app.dart';
import '../config.dart';
import '../state/session.dart';

/// Gateway connect screen with the Lodestar brand mark.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _keyCtrl = TextEditingController();
  bool _obscure = true;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _keyCtrl.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    final String key = _keyCtrl.text.trim();
    try {
      final SessionStore session = context.read<SessionStore>();
      final LodestarApi api = context.read<LodestarApi>();
      api.configure(config: session.config, apiKey: key);
      await api.health();
      final bool signedIn = await session.signIn(key);
      if (!signedIn) {
        setState(() {
          _error = 'The gateway rejected this API key.';
        });
        return;
      }
      if (!mounted) {
        return;
      }
      Navigator.of(context).pushNamedAndRemoveUntil(
        LodestarRoutes.home,
        (Route<dynamic> route) => false,
      );
    } on ApiException catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = e.message;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _error = 'Unexpected error: $e';
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final SessionStore session = context.watch<SessionStore>();

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    SizedBox(
                      width: 104,
                      height: 104,
                      child: CustomPaint(
                        painter: _LodestarMark(
                          color: LodestarColors.emerald,
                          ringColor: LodestarColors.border,
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      'LODESTAR',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.5,
                        color: LodestarColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Enterprise observability and AIOps, in the pocket of every on-call engineer.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        color: LodestarColors.textSecondary,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: 28),
                    TextFormField(
                      controller: _keyCtrl,
                      obscureText: _obscure,
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _connect(),
                      decoration: InputDecoration(
                        labelText: 'API key',
                        hintText: 'pg_live_demo_key',
                        prefixIcon: const Icon(Icons.key_outlined, size: 18),
                        suffixIcon: IconButton(
                          onPressed: () => setState(() => _obscure = !_obscure),
                          icon: Icon(
                            _obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                            size: 18,
                          ),
                        ),
                      ),
                      validator: SessionStore.validateApiKey,
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      height: 46,
                      child: FilledButton(
                        onPressed: _loading ? null : _connect,
                        child: _loading
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Color(0xFF05261A),
                                ),
                              )
                            : const Text('Connect'),
                      ),
                    ),
                    if (_error != null) ...<Widget>[
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: LodestarColors.rose.withOpacity(0.08),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: LodestarColors.rose.withOpacity(0.4)),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            const Icon(Icons.error_outline, size: 16, color: LodestarColors.rose),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: <Widget>[
                                  const Text(
                                    'Connection failed',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w700,
                                      fontSize: 12.5,
                                      color: LodestarColors.rose,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    _error!,
                                    style: const TextStyle(
                                      fontSize: 12.5,
                                      color: LodestarColors.textSecondary,
                                      height: 1.4,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    'Gateway: ${session.gatewayBaseUrl}',
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: LodestarColors.textFaint,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    const Text(
                      'Dev default: pg_live_demo_key against the gateway on 10.0.2.2:3100 '
                      '(Android emulator loopback). Endpoints are configurable in Settings.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 11, color: LodestarColors.textFaint, height: 1.5),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// North-star brand mark: an emerald four-point star inside an orbit ring.
class _LodestarMark extends CustomPainter {
  const _LodestarMark({required this.color, required this.ringColor});

  final Color color;
  final Color ringColor;

  @override
  void paint(Canvas canvas, Size size) {
    final Offset center = size.center(Offset.zero);

    final Paint ringPaint = Paint()
      ..color = ringColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    canvas.drawCircle(center, size.shortestSide * 0.48, ringPaint);

    final Paint fillPaint = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    final Path vertical = Path()
      ..moveTo(center.dx, center.dy - size.height * 0.36)
      ..lineTo(center.dx + size.width * 0.16, center.dy)
      ..lineTo(center.dx, center.dy + size.height * 0.36)
      ..lineTo(center.dx - size.width * 0.16, center.dy)
      ..close();
    final Path horizontal = Path()
      ..moveTo(center.dx - size.width * 0.36, center.dy)
      ..lineTo(center.dx, center.dy - size.height * 0.11)
      ..lineTo(center.dx + size.width * 0.36, center.dy)
      ..lineTo(center.dx, center.dy + size.height * 0.11)
      ..close();

    canvas.drawPath(vertical, fillPaint);
    canvas.drawPath(horizontal, fillPaint);
  }

  @override
  bool shouldRepaint(_LodestarMark oldDelegate) =>
      oldDelegate.color != color || oldDelegate.ringColor != ringColor;
}
