# XSS smoke test

The following line must NOT execute in the rendered DOM:

<script>alert('xss')</script>

It should appear as plain text in the rendered article.

Inline `code <script>x</script>` should also remain inert.
