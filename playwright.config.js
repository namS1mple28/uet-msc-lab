import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'tests/browser',timeout:60000,expect:{timeout:15000},fullyParallel:false,workers:2,
  use:{baseURL:'http://127.0.0.1:8765',viewport:{width:1440,height:1000},reducedMotion:'reduce',trace:'retain-on-failure'},
  projects:[
    {name:'chromium',testIgnore:/mobile\.spec\.js/,use:{browserName:'chromium'}},
    {name:'firefox',testIgnore:/mobile\.spec\.js/,use:{browserName:'firefox'}},
    {name:'chromium-mobile',testMatch:/mobile\.spec\.js/,use:{browserName:'chromium',viewport:{width:390,height:844},hasTouch:true,isMobile:true}},
  ],
  webServer:{command:'python3 -m http.server 8765 --bind 127.0.0.1',url:'http://127.0.0.1:8765',reuseExistingServer:!process.env.CI},
  reporter:[['list'],['html',{open:'never'}]],
});
