# COBROS — Pricing v2 y rollout

Este documento congela la configuración aprobada para el environment temporal. No habilita cobros en producción.

## Objetos Stripe (modo de pruebas)

Crear dos productos recurrentes:

- `IMMERSA SPEAKER`;
- `IMMERSA SPEAKER PRO`.

Cada producto tiene sus precios mensual y anual. Los importes son finales, en MXN e IVA incluido. COBROS v1 no activa Stripe Tax ni pruebas gratuitas. La facturación CFDI sigue siendo manual.

| Producto | Precio | Importe total | Moneda | Intervalo |
| --- | --- | ---: | --- | --- |
| IMMERSA SPEAKER | mensual | $999.00 | MXN | month |
| IMMERSA SPEAKER | anual | $9,990.00 | MXN | year |
| IMMERSA SPEAKER PRO | mensual | $2,999.00 | MXN | month |
| IMMERSA SPEAKER PRO | anual | $29,990.00 | MXN | year |

Crear dos cupones de importe fijo y duración `forever` para Precio Fundadores anual:

| Cupón | Descuento fijo | Precio final |
| --- | ---: | ---: |
| SPEAKER anual | $2,000.00 MXN | $7,990.00 MXN |
| SPEAKER PRO anual | $6,000.00 MXN | $23,990.00 MXN |

No combinar el cupón Fundadores con otro descuento. Cada cupón debe tener duración `forever`, sin `redeem_by`, sin límite de redenciones y mantenerse activo en Stripe mientras sea elegible para una fase futura. La elegibilidad inicial termina el 31 de octubre de 2026 a las 11:59:59 p.m. de Ciudad de México. Founders sólo está disponible para membresías anuales y una suscripción Founders activa conserva su precio mientras permanezca activa.

Los precios aprobados por evento son $799.00 MXN para SPEAKER y $2,499.00 MXN para SPEAKER PRO. El Checkout por evento queda como modalidad separada: no debe modelarse como una suscripción recurrente ni activar el entitlement mensual hasta definir su webhook y vigencia.

## Customer Portal

Crear una configuración exclusiva para IMMERSA con:

- encabezado: `Administra tu suscripción y método de pago de IMMERSA.`;
- método de pago: habilitado;
- historial de facturas/recibos: habilitado;
- datos de cliente: deshabilitados;
- cancelación: al final del periodo, sin prorrateo;
- cambio de plan o intervalo: deshabilitado en Portal;
- pausar suscripción: deshabilitado;
- enlace público sin código: deshabilitado;
- URL de retorno: enviada por IMMERSA para cada environment.

Los upgrades inmediatos y los cambios mensuales a anuales se ejecutan en el backend mediante la API de Stripe Billing, con el precio normal y el cupón Fundadores explícito cuando corresponda. Se genera una factura de prorrateo y, si requiere acción del cliente, IMMERSA devuelve la URL alojada de Stripe. Un webhook posterior reconcilia el plan efectivo; el retorno del navegador nunca concede acceso. El Portal queda reservado para método de pago, facturas/recibos, cancelación y cambios programados al final del periodo.

Los cambios se rigen por estas reglas:

- upgrade y mensual a anual: inmediatos, con crédito o prorrateo mostrado y confirmado por Stripe;
- downgrade y anual a mensual: al final del periodo mediante un Subscription Schedule de Stripe con dos fases; la fase vigente se conserva intacta y la siguiente usa el nuevo precio con `end_behavior=release` y sin prorrateo;
- nunca borrar Decks automáticamente;
- conservar las validaciones de presentación activa y recursos excedentes.

## Variables Railway

Configurar únicamente como variables privadas del environment temporal:

```text
IMMERSA_BILLING_ENABLED=true
IMMERSA_BILLING_CHECKOUT_ENABLED=true
IMMERSA_FOUNDERS_OFFER_END_AT=2026-10-31T23:59:59-06:00
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_SPEAKER_MONTHLY_PRICE_ID=price_...
STRIPE_SPEAKER_ANNUAL_PRICE_ID=price_...
STRIPE_SPEAKER_PRO_MONTHLY_PRICE_ID=price_...
STRIPE_SPEAKER_PRO_ANNUAL_PRICE_ID=price_...
STRIPE_FOUNDERS_SPEAKER_ANNUAL_COUPON_ID=...
STRIPE_FOUNDERS_SPEAKER_PRO_ANNUAL_COUPON_ID=...
```

`STRIPE_SECRET_KEY` debe ser una clave restringida de pruebas, con el mínimo de permisos que requiera la aplicación. Mantener en producción:

```text
IMMERSA_BILLING_ENABLED=false
IMMERSA_BILLING_CHECKOUT_ENABLED=false
```

No guardar llaves, secretos, IDs reales de objetos ni payloads con datos personales en GitHub.

## Webhook temporal

Apuntar el endpoint de Stripe al environment temporal:

```text
POST /api/billing/webhooks/stripe
```

La ruta recibe el cuerpo crudo y valida `stripe-signature` con `STRIPE_WEBHOOK_SECRET`. El repositorio registra cada evento para procesamiento idempotente y tolera eventos repetidos, retrasados o fuera de orden.

Suscribir únicamente:

- `checkout.session.completed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.payment_action_required`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.pending_update_applied`
- `customer.subscription.pending_update_expired`

## Matriz de aprobación

No habilitar producción hasta documentar evidencia de:

- pago mensual y anual exitosos para ambos planes;
- Checkout cancelado;
- pago fallido y recuperación;
- webhook con firma inválida, duplicado, retrasado y fuera de orden;
- upgrade inmediato con prorrateo y confirmación de pago;
- downgrade al final del periodo;
- cambio mensual a anual inmediato con crédito;
- cambio anual a mensual al final del periodo;
- cancelación programada y efectiva;
- cupón Fundadores y código promocional permitido;
- solicitud CFDI ordinaria y extemporánea;
- piloto, cortesía y activación manual sin datos Stripe falsos;
- presentación activa y recursos excedentes sin borrado automático.

La ausencia de un deployment asociado al SHA o de evidencia Stripe en modo de pruebas bloquea el rollout. El merge a `main` requiere confirmación expresa.
