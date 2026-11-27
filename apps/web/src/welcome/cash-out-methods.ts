export type CashOut = {
  flag: string;
  method: string;
  logo: string;
  amount: string;
  receiverUsername: string;
  longitude: number;
  latitude: number;
};

export type CashOuts = readonly [CashOut, ...ReadonlyArray<CashOut>];

const asset = (path: string) => `/cash-out/${path}`;

export const cashOuts: CashOuts = [
  {
    flag: asset("flags/pe.svg"),
    method: "Yape",
    logo: asset("logos/yape.png"),
    amount: "S/ 70.00",
    receiverUsername: "raul",
    longitude: -77.04,
    latitude: -12.05,
  },
  {
    flag: asset("flags/co.svg"),
    method: "Nequi",
    logo: asset("logos/nequi.svg"),
    amount: "$ 78.000 COP",
    receiverUsername: "beto",
    longitude: -74.07,
    latitude: 4.71,
  },
  {
    flag: asset("flags/mx.svg"),
    method: "Mercado Pago",
    logo: asset("logos/mercadopago.svg"),
    amount: "MX$ 370.00",
    receiverUsername: "leo",
    longitude: -99.13,
    latitude: 19.43,
  },
  {
    flag: asset("flags/br.svg"),
    method: "Pix",
    logo: asset("logos/pix.svg"),
    amount: "R$ 108,00",
    receiverUsername: "camila",
    longitude: -46.63,
    latitude: -23.55,
  },
  {
    flag: asset("flags/ke.svg"),
    method: "M-Pesa",
    logo: asset("logos/mpesa.svg"),
    amount: "KSh 2,580",
    receiverUsername: "rosa",
    longitude: 36.82,
    latitude: -1.29,
  },
  {
    flag: asset("flags/in.svg"),
    method: "UPI",
    logo: asset("logos/upi.svg"),
    amount: "₹ 1,760",
    receiverUsername: "priya",
    longitude: 72.88,
    latitude: 19.08,
  },
  {
    flag: asset("flags/ph.svg"),
    method: "GCash",
    logo: asset("logos/gcash.svg"),
    amount: "₱ 1,160",
    receiverUsername: "rico",
    longitude: 120.98,
    latitude: 14.6,
  },
];

export const cashOutAt = (turn: number) =>
  cashOuts[turn % cashOuts.length] ?? cashOuts[0];
