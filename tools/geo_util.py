"""Decode ECharts map GeoJSON (UTF8Encoding-compressed rings) into plain lon/lat polygons."""
import json
def decode_ring(s, off, scale=1024):
    out=[]; px,py=off
    for i in range(0,len(s),2):
        x=ord(s[i])-64; y=ord(s[i+1])-64
        x=(x>>1)^(-(x&1)); y=(y>>1)^(-(y&1))
        x+=px; y+=py; px,py=x,y
        out.append((x/scale,y/scale))
    return out
def features(path):
    d=json.load(open(path, encoding='utf8')); res=[]
    enc=d.get('UTF8Encoding'); sc=d.get('UTF8Scale') or 1024
    for f in d['features']:
        g=f['geometry']; polys=[]
        if g['type']=='Polygon':
            polys=[[decode_ring(r,g['encodeOffsets'][k],sc) if enc and isinstance(r,str) else r for k,r in enumerate(g['coordinates'])]]
        elif g['type']=='MultiPolygon':
            polys=[[decode_ring(r,g['encodeOffsets'][a][k],sc) if enc and isinstance(r,str) else r for k,r in enumerate(p)] for a,p in enumerate(g['coordinates'])]
        res.append(dict(name=f['properties'].get('name',''),cp=f['properties'].get('cp'),polys=polys))
    return res
