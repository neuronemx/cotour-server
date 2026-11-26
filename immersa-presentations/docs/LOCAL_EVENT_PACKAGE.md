# Paquete de Event Hub para IMMERSA Local

El paquete Local se prepara en Cloud, desde **Administración → Event Hub → Paquete Local**. Descarga un único archivo `.immersa-local.zip` para el evento que vas a presentar.

Incluye los Decks asignados al Programa, sus archivos, Stages, actividades, acceso Free/Paid, QR públicos y las Marcas/Menciones con sus logos. No exporta cuentas, cobro, asistentes ni analítica de Cloud.

En la laptop Local, con el servicio ya iniciado y el archivo disponible dentro del contenedor, impórtalo una vez:

```bash
npm run local:import-event -- /ruta/al/evento.immersa-local.zip
```

La importación verifica el formato y los checksums antes de modificar el Event Hub. Se puede repetir: actualiza el mismo Event Hub, sus Stages, Programa y QR por `workspaceId`; no duplica el evento.

Para una prueba LAN, abre primero el QR del paquete desde un dispositivo conectado a la misma red. Las menciones de marca aparecen en el Programa exactamente como quedaron configuradas en Cloud.
