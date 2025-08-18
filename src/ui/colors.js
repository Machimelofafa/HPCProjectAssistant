export function colorFor(subsys) {
  const M = {
    'power/VRM': '--pwr',
    'PCIe': '--pcie',
    'BMC': '--bmc',
    'BIOS': '--bios',
    'FW': '--fw',
    'Mech': '--mech',
    'Thermal': '--thermal',
    'System': '--sys'
  };
  const v = M[subsys] || '--ok';
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#16a34a';
}
