// Dependency-free local preview; Android packages only explicitly listed assets.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';

const args=process.argv.slice(2);
const flag=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const port=Number(flag('--port','4173'));
const host=flag('--host','0.0.0.0');
const root=resolve(process.cwd());
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.webp':'image/webp'};

http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const file=resolve(root,'.'+name);
    if(!file.startsWith(root+sep)){
      res.writeHead(403).end('Forbidden');return;
    }
    let data=await readFile(file);
    // Local visual-QA mode only: it is never packaged into the Android APK.
    // Show representative cards without signing in or touching real accounts.
    if(name==='/index.html'&&url.searchParams.get('qa')==='home'){
      let html=data.toString('utf8');
      html=html.replace('</head>',
        '<style>#au,#sp,#wk,.wtop,.weekly{display:none!important}</style></head>');
      html=html.replace('</body>',`<script>
        setTimeout(function(){
          if(!window.CFG||!window.renderRooms)return;
          window.CFG.viewerCountry='Bangladesh';
          window.CFG.roomHistoryIds=['10000002'];
          window.CFG.rooms=[
            {id:'10000001',name:'Official Bangladesh',emoji:'👑',n:26,c:'#704220,#d5a460',tag:'Voice Room',mics:[],owner_country:'BD'},
            {id:'10000002',name:'Global Music Lounge',emoji:'🎤',n:115,c:'#473b46,#947563',tag:'Music',mics:[],owner_country:'US'},
            {id:'10000003',name:'Dhaka Friends',emoji:'🎙️',n:8,c:'#50311d,#d4a75c',tag:'Live chat',mics:[],owner_country:'Bangladesh'}
          ];
          window.renderRooms();
        },400);
      </script></body>`);
      data=Buffer.from(html);
    }
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream',
      'Cache-Control':'no-store'});
    res.end(data);
  }catch(error){res.writeHead(404).end('Not found');}
}).listen(port,host,()=>console.log(`Sharika Home preview ready at ${host}:${port}`));
