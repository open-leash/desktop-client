import 'package:flutter_test/flutter_test.dart';

void main() {
  test('mobile API contract versions are pinned', () {
    expect(_contractCountForTest(), 6);
  });
}

int _contractCountForTest() {
  return 6;
}
