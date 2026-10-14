# `public/menu/`

Las fotos del menú **ya no van aquí**. El menú web muestra las que se cargan en
el POS, y llegan al navegador por `/api/menu/image/<id>`.

Para agregar o cambiar fotos:

1. Deja los originales (PNG o JPG, como salgan de la cámara o del diseñador) en
   cualquier carpeta.
2. Prepáralos, desde la raíz del repo:

   ```
   node scripts/prepare-menu-images.mjs buteco-do-pica-pau <carpeta-con-los-originales>
   ```

   Recorta el margen vacío, las achica y las deja en WebP en
   `demos/buteco-do-pica-pau/images/` (una foto de 1 MB queda en unos 60 KB).
3. En `demos/buteco-do-pica-pau/menu.json`, pon el nombre del archivo en el
   campo `image` del producto.
4. Cárgalo en el backend: `node scripts/load-demo.mjs buteco-do-pica-pau`.

Lo que se deje en esta carpeta queda publicado tal cual con el sitio, pese lo
que pese, y el menú no lo usa.
