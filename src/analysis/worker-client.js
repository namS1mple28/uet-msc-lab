// Mỗi tác vụ dùng worker riêng: hủy và timeout dừng cả phép tính đang chạy.
export class WorkerClient {
  constructor() { this.sequence=0; this.pending=null; }
  run(type, dataset, params={}, onProgress=()=>{}) {
    this.cancel();
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(new Blob([globalThis.__MSC_WORKER_SOURCE__],{type:'text/javascript'}));
      let worker;
      try { worker=new Worker(url); } catch (error) { URL.revokeObjectURL(url); reject(error); return; }
      const finish=()=>{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);if(this.pending?.id===id)this.pending=null;};
      const timer=setTimeout(()=>{finish();reject(new Error('Tác vụ vượt quá 30 giây. Hãy thu hẹp vùng phân tích.'));},30000);
      this.pending={id,reject,finish};
      worker.onmessage=({data})=>{
        if(this.pending?.id!==data.id)return;
        onProgress(data.progress ?? 0);
        if(data.error){finish();reject(new Error(data.error));}
        else if(data.result){finish();resolve(data.result);}
      };
      worker.onerror=e=>{finish();reject(new Error(e.message || 'Không thể chạy phép phân tích.'));};
      worker.postMessage({id,type,dataset,params});
    });
  }
  cancel() {
    if(!this.pending)return;
    const {finish,reject}=this.pending;
    finish();reject(new DOMException('Đã hủy phép phân tích.','AbortError'));
  }
}
