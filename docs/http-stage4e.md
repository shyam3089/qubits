# HTTP Stage 4E verification notes

Stage 4E freezes the Stage 1–4D HTTP and browser-connection surface. It adds no
syntax. The verification matrix covers named clients, dependent and cached queries,
imperative requests, actions and optimistic rollback, file transfers, WebSockets,
SSE, and application-scoped services.

## Security and ownership boundaries

- Service instances and their caches belong to one root application. Consumers in
  that application share one instance; separate roots receive separate instances and
  cache namespaces, even when credentials are identical.
- All consumers of one service in an application must provide the same inherited
  named-client configuration. A conflicting base, authentication provider, or
  interceptor declaration fails mounting and rolls back the partial component tree.
- Authenticated HTTP requests use `redirect: "error"`, same-origin credentials, and
  never place bearer tokens in URLs. WebSocket and EventSource cannot receive custom
  Authorization headers; their authentication is limited to secure same-origin
  cookies or application-controlled message protocols.
- Component disposal suppresses stale query/action UI commits. Safe reads are
  aborted when their final owner is destroyed. Unsafe actions intentionally continue
  unless the application calls their explicit cancellation API.
- Response schemas, collection limits, transfer limits, connection queues, message
  sizes, retry counts, component work, and DOM allocations are bounded. Application
  host functions, interceptors, browser cookie policy, and asynchronous side effects
  remain trusted and are not sandboxed or transactionally reversible.

## Remaining limitations for Stage 5

- Service lifetime is root-application scoped rather than last-consumer scoped.
- Query responses still require explicit response declarations. Action parameters
  constrained by optimistic assignments are inferred; otherwise they remain unknown
  because the language has no parameter annotation syntax.
- Inherited client base expressions must be self-contained in the service execution
  scope. Literal bases are the portable configuration.
- Unauthenticated redirects follow browser Fetch and CORS policy. Authenticated
  redirects are rejected before credentials can be forwarded.
- Firefox does not expose a portable precise heap metric. Retention checks therefore
  use disposal counters, listener/timer balance, aborted requests, detached DOM, and
  weak-reference observations where available.
- The framework bounds its own queues and payload processing, but server rate limits,
  connection quotas, CSP, cookie attributes, and deployment TLS remain application
  responsibilities.

The full documentation reorganization is deferred to Stage 5.
