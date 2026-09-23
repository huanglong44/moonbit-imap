import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

/** Pinned independent test server. Binds only loopback, temporary in-memory mail.
 * No external accounts, credentials or network services are used. */
export async function withGreenMail(run){
  const jar=process.env.GREENMAIL_JAR;if(!jar)throw Error('Set GREENMAIL_JAR to greenmail-standalone-2.1.13.jar (see TESTING.md)');
  const artifact=fs.readFileSync(jar),digest=createHash('sha1').update(artifact).digest('hex'),sha256=createHash('sha256').update(artifact).digest('hex');
  if(sha256!=='21b361e46e8ffe83afe7915a2b01231c4a163c8d0fa5de607e32ed19732d908d')throw Error('GreenMail checksum mismatch');
  const child=spawn(process.env.JAVA??'java',['-cp',path.resolve(jar),fileURLToPath(new URL('./ImapReference.java',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-10000);});child.stdin.on('error',()=>{});
  const stopped=new Promise(resolve=>{child.once('exit',code=>resolve(code));child.once('error',()=>resolve(-1));});
  try{
    const port=await new Promise((resolve,reject)=>{
      let output='';const timer=setTimeout(()=>reject(Error('GreenMail startup timeout: '+stderr)),20000);
      child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(Error('GreenMail exited '+code+': '+stderr));});
      child.stdout.on('data',b=>{output+=b;const m=/READY ([0-9]+)/.exec(output);if(m){clearTimeout(timer);resolve(Number(m[1]));}});
    });
    return await run({host:'127.0.0.1',port,secure:false,allowInsecureAuth:true,timeout:5000,server:'GreenMail 2.1.13',artifactSha1:digest,artifactSha256:sha256});
  }finally{
    if(child.exitCode===null&&child.signalCode===null){child.stdin.end('\n');const timer=setTimeout(()=>child.kill(),5000);await stopped;clearTimeout(timer);}
  }
}
