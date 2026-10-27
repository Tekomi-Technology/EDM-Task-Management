import { customType } from 'drizzle-orm/pg-core';

/** PostGIS point in WGS 84, read and written as { lng, lat }. */
export const point = customType<{ data: { lng: number; lat: number }; driverData: string }>({
  dataType() {
    return 'geometry(Point, 4326)';
  },
  toDriver(value) {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
  fromDriver(value) {
    // node-postgres returns PostGIS geometry as hex EWKB: little-endian, type with SRID flag, SRID, x, y.
    const buf = Buffer.from(value, 'hex');
    const littleEndian = buf.readUInt8(0) === 1;
    const type = littleEndian ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
    const offset = type & 0x20000000 ? 9 : 5;
    const lng = littleEndian ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
    const lat = littleEndian ? buf.readDoubleLE(offset + 8) : buf.readDoubleBE(offset + 8);
    return { lng, lat };
  }
});

/** PostGIS multipolygon in WGS 84, written as WKT; only used for routing queries inside the database. */
export const multiPolygon = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(MultiPolygon, 4326)';
  },
  toDriver(wkt) {
    return `SRID=4326;${wkt}`;
  }
});
