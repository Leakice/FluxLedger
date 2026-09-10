export const seed = [
 {id:1,description:'Monthly salary',amount:9840.41,type:'income',category:'Salary',card:'4329',date:'2026-09-01'},
 {id:2,description:'Freelance project',amount:5041.33,type:'income',category:'Other',card:'8851',date:'2026-09-04'},
 ...[['Food & Drinks',3720.19,'4329','Weekly groceries & dining'],['Entertainment',2880.75,'4329','Weekend experiences'],['Utilities',1920.36,'8851','Home & utilities'],['Shopping',1440.25,'8851','Everyday essentials'],['Subscription',960.19,'4329','Software & subscriptions'],['Other',1090.77,'8851','Travel & other expenses']].map((x,i)=>({id:i+3,category:x[0],amount:x[1],card:x[2],description:x[3],type:'expense',date:`2026-09-0${i+2}`})),
 ...[[4,9800,7320],[5,13350,9050],[6,8100,6840],[7,11600,7970]].flatMap(([month,income,expense])=>[{id:100+month,description:'Monthly salary',amount:income,type:'income',category:'Salary',card:'4329',date:`2026-0${month}-01`},{id:200+month,description:'Home & utilities',amount:expense,type:'expense',category:'Utilities',card:'8851',date:`2026-0${month}-15`}]),
 {id:20,description:'August salary',amount:12440.25,type:'income',category:'Salary',card:'4329',date:'2026-08-01'},
 {id:21,description:'August living expenses',amount:8564.25,type:'expense',category:'Other',card:'8851',date:'2026-08-20'}
];