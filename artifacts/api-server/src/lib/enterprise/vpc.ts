import { logger } from "../logger";

/**
 * Phase 14: Enterprise VPC/Network Layer
 * Infrastructure-as-Code for dedicated VPC, peering, static IPs, and network isolation.
 * $0 budget — uses open-source Terraform, cloud provider free tiers, and standard networking.
 */

export interface VPCConfig {
  /** Cloud provider */
  provider: "gcp" | "aws" | "azure";
  /** Region for deployment */
  region: string;
  /** VPC CIDR block (e.g., 10.0.0.0/16) */
  cidrBlock: string;
  /** Project/workspace ID this VPC belongs to */
  projectId: string;
  /** Environment (dev, staging, prod) */
  environment: string;
  /** Enable VPC peering with other VPCs */
  enablePeering?: boolean;
  /** Peering connections */
  peerings?: VPCPeeringConfig[];
  /** Static outbound IPs (NAT gateways) */
  staticOutboundIPs?: number;
  /** Private service connect / Private Link endpoints */
  privateEndpoints?: PrivateEndpointConfig[];
  /** Subnet configuration */
  subnets: SubnetConfig[];
  /** Firewall rules */
  firewallRules?: FirewallRuleConfig[];
  /** DNS configuration */
  dns?: DNSConfig;
  /** Flow logs configuration */
  flowLogs?: FlowLogsConfig;
}

export interface SubnetConfig {
  name: string;
  cidrBlock: string;
  region?: string;
  zone?: string;
  purpose: "public" | "private" | "database" | "cache" | "internal" | "managed";
  /** Enable private Google Access / VPC endpoints */
  privateAccess?: boolean;
  /** NAT gateway for this subnet */
  natGateway?: boolean;
}

export interface VPCPeeringConfig {
  /** Name of the peering connection */
  name: string;
  /** Target VPC (can be in different project/account) */
  targetVPC: string;
  /** Target project/account ID */
  targetProjectId: string;
  /** Target network name */
  targetNetwork: string;
  /** Auto-create routes */
  autoCreateRoutes?: boolean;
  /** Export custom routes */
  exportCustomRoutes?: boolean;
  /** Import custom routes */
  importCustomRoutes?: boolean;
}

export interface PrivateEndpointConfig {
  name: string;
  /** Service to connect to (e.g., storage, sql, redis, pubsub) */
  service: string;
  /** Subnet to attach endpoint to */
  subnet: string;
  /** IP address (optional, auto-assigned if not specified) */
  ipAddress?: string;
}

export interface FirewallRuleConfig {
  name: string;
  direction: "ingress" | "egress";
  action: "allow" | "deny";
  priority: number;
  /** Source/destination ranges */
  ranges: string[];
  /** Protocol and ports */
  protocols: ProtocolPortConfig[];
  /** Target tags or service accounts */
  targets?: string[];
  /** Source service accounts (for ingress) */
  sourceServiceAccounts?: string[];
  /** Description */
  description?: string;
  /** Enable logging */
  logConfig?: "all" | "denied" | "none";
}

export interface ProtocolPortConfig {
  protocol: "tcp" | "udp" | "icmp" | "esp" | "ah" | "sctp" | "all";
  ports?: string[]; // e.g., ["80", "443", "8000-9000"]
}

export interface DNSConfig {
  /** Private DNS zone name */
  zoneName: string;
  /** DNS server IP (for on-prem forwarding) */
  forwardingIPs?: string[];
  /** DNS peering with other VPCs */
  dnsPeering?: DNSPeeringConfig[];
}

export interface DNSPeeringConfig {
  name: string;
  targetProjectId: string;
  targetNetwork: string;
  targetZone: string;
}

export interface FlowLogsConfig {
  enabled: boolean;
  /** Sampling rate (0.0 - 1.0) */
  samplingRate?: number;
  /** Filter (e.g., "all", "accept", "deny") */
  filter?: string;
  /** Destination (logging, pubsub, bigquery) */
  destination: "logging" | "pubsub" | "bigquery";
  /** Destination details */
  destinationConfig: Record<string, unknown>;
  /** Aggregation interval */
  aggregationInterval?: "interval_5_sec" | "interval_30_sec" | "interval_1_min" | "interval_5_min" | "interval_10_min" | "interval_15_min";
}

export interface VPCOutput {
  vpcId: string;
  vpcName: string;
  subnets: SubnetOutput[];
  natIPs: string[];
  peeringConnections: PeeringOutput[];
  privateEndpoints: PrivateEndpointOutput[];
}

export interface SubnetOutput {
  name: string;
  id: string;
  cidrBlock: string;
  region: string;
  purpose: string;
  privateAccess: boolean;
}

export interface PeeringOutput {
  name: string;
  id: string;
  state: "active" | "inactive" | "pending";
  targetVPC: string;
}

export interface PrivateEndpointOutput {
  name: string;
  id: string;
  ipAddress: string;
  service: string;
  subnet: string;
}

/**
 * Terraform module generator for VPC infrastructure
 */
export class VPCModuleGenerator {
  private config: VPCConfig;

  constructor(config: VPCConfig) {
    this.config = config;
  }

  /** Generate complete Terraform configuration for the VPC */
  generateTerraform(): TerraformOutput {
    const files: Record<string, string> = {};

    // Main VPC resource
    files["main.tf"] = this.generateMainTF();

    // Subnets
    files["subnets.tf"] = this.generateSubnetsTF();

    // NAT Gateways
    if (this.config.staticOutboundIPs && this.config.staticOutboundIPs > 0) {
      files["nat.tf"] = this.generateNATGatewayTF();
    }

    // VPC Peering
    if (this.config.enablePeering && this.config.peerings?.length) {
      files["peering.tf"] = this.generatePeeringTF();
    }

    // Private Endpoints
    if (this.config.privateEndpoints?.length) {
      files["private-endpoints.tf"] = this.generatePrivateEndpointsTF();
    }

    // Firewall Rules
    if (this.config.firewallRules?.length) {
      files["firewall.tf"] = this.generateFirewallTF();
    }

    // DNS
    if (this.config.dns) {
      files["dns.tf"] = this.generateDNSTF();
    }

    // Flow Logs
    if (this.config.flowLogs?.enabled) {
      files["flow-logs.tf"] = this.generateFlowLogsTF();
    }

    // Variables
    files["variables.tf"] = this.generateVariablesTF();

    // Outputs
    files["outputs.tf"] = this.generateOutputsTF();

    // Provider configuration
    files["providers.tf"] = this.generateProvidersTF();

    return {
      provider: this.config.provider,
      region: this.config.region,
      projectId: this.config.projectId,
      files,
    };
  }

  private generateProvidersTF(): string {
    switch (this.config.provider) {
      case "gcp":
        return `# Google Cloud Provider
terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}`;
      case "aws":
        return `# AWS Provider
terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}`;
      case "azure":
        return `# Azure Provider
terraform {
  required_version = ">= 1.5"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}`;
      default:
        return "";
    }
  }

  private generateMainTF(): string {
    const vpcName = `infinity-${this.config.projectId}-${this.config.environment}`;

    switch (this.config.provider) {
      case "gcp":
        return `# VPC Network
resource "google_compute_network" "vpc" {
  name                    = "${vpcName}"
  auto_create_subnetworks = false
  description             = "Infinity AI VPC for project ${this.config.projectId} (${this.config.environment})"
  mtu                     = 1460
  routing_mode            = "GLOBAL"

  delete_default_routes_on_create = false
}`;
      case "aws":
        return `# VPC
resource "aws_vpc" "vpc" {
  cidr_block           = var.cidr_block
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "${vpcName}"
    Project     = var.project_id
    Environment = var.environment
    ManagedBy   = "infinity-terraform"
  }
}`;
      case "azure":
        return `# Virtual Network
resource "azurerm_virtual_network" "vpc" {
  name                = "${vpcName}"
  address_space       = [var.cidr_block]
  location            = var.region
  resource_group_name = azurerm_resource_group.rg.name

  tags = {
    Project     = var.project_id
    Environment = var.environment
    ManagedBy   = "infinity-terraform"
  }
}`;
      default:
        return "";
    }
  }

  private generateSubnetsTF(): string {
    const subnets = this.config.subnets.map((subnet, index) => {
      const subnetName = `infinity-${this.config.projectId}-${this.config.environment}-${subnet.name}`;

      switch (this.config.provider) {
        case "gcp":
          return `
resource "google_compute_subnetwork" "${subnet.name}" {
  name          = "${subnetName}"
  ip_cidr_range = "${subnet.cidrBlock}"
  region        = "${subnet.region || this.config.region}"
  network       = google_compute_network.vpc.id
  purpose       = ${subnet.purpose === "private" ? "PRIVATE" : subnet.purpose === "public" ? "PUBLIC" : "PRIVATE"}
  role          = ${subnet.purpose === "database" ? "ACTIVE" : subnet.purpose === "cache" ? "ACTIVE" : "ACTIVE"}
  private_ip_google_access = ${subnet.privateAccess ?? true}
  secondary_ip_range = []

  description = "Infinity subnet for ${subnet.purpose} workloads"
}`;
        case "aws":
          const az = subnet.zone || `${this.config.region}${String.fromCharCode(97 + index)}`;
          return `
resource "aws_subnet" "${subnet.name}" {
  vpc_id                  = aws_vpc.vpc.id
  cidr_block              = "${subnet.cidrBlock}"
  availability_zone       = "${az}"
  map_public_ip_on_launch = ${subnet.purpose === "public"}

  tags = {
    Name        = "${subnetName}"
    Purpose     = "${subnet.purpose}"
    Project     = var.project_id
    Environment = var.environment
  }
}`;
        case "azure":
          return `
resource "azurerm_subnet" "${subnet.name}" {
  name                 = "${subnetName}"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vpc.name
  address_prefixes     = ["${subnet.cidrBlock}"]
}`;
        default:
          return "";
      }
    });

    return subnets.join("\n");
  }

  private generateNATGatewayTF(): string {
    const count = this.config.staticOutboundIPs || 1;

    switch (this.config.provider) {
      case "gcp":
        return `
# Cloud NAT for static outbound IPs
resource "google_compute_router" "nat_router" {
  name    = "infinity-${this.config.projectId}-${this.config.environment}-nat-router"
  network = google_compute_network.vpc.id
  region  = var.region
}

resource "google_compute_router_nat" "nat" {
  name                               = "infinity-${this.config.projectId}-${this.config.environment}-nat"
  router                             = google_compute_router.nat_router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  number_of_nat_ips                  = ${count}
  min_ports_per_vm                   = 64
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  log_config {
    enable = true
    filter = "ALL"
  }
}`;
      case "aws":
        return `
# NAT Gateways for static outbound IPs
resource "aws_eip" "nat" {
  count  = ${count}
  domain = "vpc"
  tags = {
    Name        = "infinity-${this.config.projectId}-${this.config.environment}-nat-\${count.index}"
    Project     = var.project_id
    Environment = var.environment
  }
}

resource "aws_nat_gateway" "nat" {
  count         = ${count}
  subnet_id     = aws_subnet.public[0].id
  allocation_id = aws_eip.nat[count.index].id

  tags = {
    Name        = "infinity-${this.config.projectId}-${this.config.environment}-nat-\${count.index}"
    Project     = var.project_id
    Environment = var.environment
  }
}`;
      case "azure":
        return `
# NAT Gateway for static outbound IPs
resource "azurerm_nat_gateway" "nat" {
  name                = "infinity-${this.config.projectId}-${this.config.environment}-nat"
  location            = var.region
  resource_group_name = azurerm_resource_group.rg.name
  sku_name            = "Standard"
  idle_timeout_in_minutes = 4

  # Create public IP prefixes for static outbound IPs
  public_ip_prefixes = [azurerm_public_ip_prefix.nat.id]
}

resource "azurerm_public_ip_prefix" "nat" {
  name                = "infinity-${this.config.projectId}-${this.config.environment}-nat-pip"
  location            = var.region
  resource_group_name = azurerm_resource_group.rg.name
  prefix_length       = 31 # /31 gives 2 IPs, adjust based on count
  sku                 = "Standard"
}`;
      default:
        return "";
    }
  }

  private generatePeeringTF(): string {
    const peerings = this.config.peerings?.map(peering => {
      switch (this.config.provider) {
        case "gcp":
          return `
resource "google_compute_network_peering" "${peering.name}" {
  name         = "${peering.name}"
  network      = google_compute_network.vpc.id
  peer_network = "projects/${peering.targetProjectId}/global/networks/${peering.targetNetwork}"
  auto_create_routes = ${peering.autoCreateRoutes ?? false}
  export_custom_routes = ${peering.exportCustomRoutes ?? false}
  import_custom_routes = ${peering.importCustomRoutes ?? false}
}`;
        case "aws":
          return `
resource "aws_vpc_peering_connection" "${peering.name}" {
  vpc_id        = aws_vpc.vpc.id
  peer_vpc_id   = "${peering.targetVPC}"
  peer_owner_id = "${peering.targetProjectId}"
  auto_accept   = true

  tags = {
    Name        = "${peering.name}"
    Project     = var.project_id
    Environment = var.environment
  }
}`;
        case "azure":
          return `
resource "azurerm_virtual_network_peering" "${peering.name}" {
  name                         = "${peering.name}"
  resource_group_name          = azurerm_resource_group.rg.name
  virtual_network_name         = azurerm_virtual_network.vpc.name
  remote_virtual_network_id    = "${peering.targetVPC}"
  allow_virtual_network_access = true
  allow_forwarded_traffic      = true
  allow_gateway_transit        = false
  use_remote_gateways          = false
}`;
        default:
          return "";
      }
    });

    return peerings?.join("\n") || "";
  }

  private generatePrivateEndpointsTF(): string {
    const endpoints = this.config.privateEndpoints?.map(endpoint => {
      switch (this.config.provider) {
        case "gcp":
          return `
resource "google_compute_network_endpoint_group" "${endpoint.name}" {
  name                  = "${endpoint.name}"
  network_endpoint_type = "NON_GCP_PRIVATE_SERVICE_CONNECT"
  network               = google_compute_network.vpc.id
  region                = var.region
  default_port          = 443

  # Private Service Connect configuration
  psc_data {
    service_attachment = "projects/${this.config.projectId}/regions/${this.config.region}/serviceAttachments/${endpoint.service}"
    target_ip_address  = "${endpoint.ipAddress || ""}"
  }
}`;
        case "aws":
          return `
resource "aws_vpc_endpoint" "${endpoint.name}" {
  vpc_id            = aws_vpc.vpc.id
  service_name      = "com.amazonaws.${this.config.region}.${endpoint.service}"
  vpc_endpoint_type = "Interface"
  subnet_ids        = [aws_subnet.${endpoint.subnet}.id]
  private_dns_enabled = true

  tags = {
    Name        = "${endpoint.name}"
    Project     = var.project_id
    Environment = var.environment
  }
}`;
        case "azure":
          return `
resource "azurerm_private_endpoint" "${endpoint.name}" {
  name                = "${endpoint.name}"
  location            = var.region
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.${endpoint.subnet}.id

  private_service_connection {
    name                           = "${endpoint.name}-connection"
    private_connection_resource_id = "/subscriptions/${this.config.projectId}/resourceGroups/.../providers/Microsoft.${endpoint.service}"
    subresource_names              = ["${endpoint.service}"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.${endpoint.service}.id]
  }
}`;
        default:
          return "";
      }
    });

    return endpoints?.join("\n") || "";
  }

  private generateFirewallTF(): string {
    const rules = this.config.firewallRules?.map(rule => {
      const protocols = rule.protocols.map(p => {
        if (p.protocol === "all") {
          return this.config.provider === "gcp"
            ? `protocol = "all"`
            : `protocol = "-1"`;
        }
        const ports = p.ports?.join(",") || "";
        return this.config.provider === "gcp"
          ? `protocol = "${p.protocol}"\n  ports = ["${ports}"]`
          : `protocol = "${p.protocol}"\n  from_port = ${p.ports?.[0] || 0}\n  to_port = ${p.ports?.[p.ports.length - 1] || 65535}`;
      }).join("\n");

      switch (this.config.provider) {
        case "gcp":
          return `
resource "google_compute_firewall" "${rule.name}" {
  name    = "${rule.name}"
  network = google_compute_network.vpc.name
  direction = "${rule.direction.toUpperCase()}"
  priority  = ${rule.priority}
  ${rule.action === "allow" ? "allow" : "deny"} {
${protocols.split("\n").map(l => "    " + l).join("\n")}
  }
  ${rule.ranges.length > 0 ? `source_ranges = [${rule.ranges.map(r => `"${r}"`).join(", ")}]` : ""}
  ${rule.targets?.length ? `target_tags = [${rule.targets.map(t => `"${t}"`).join(", ")}]` : ""}
  ${rule.sourceServiceAccounts?.length ? `source_service_accounts = [${rule.sourceServiceAccounts.map(s => `"${s}"`).join(", ")}]` : ""}
  description = "${rule.description || ""}"
  log_config {
    metadata = "${rule.logConfig || "NONE"}"
  }
}`;
        case "aws":
          return `
resource "aws_security_group_rule" "${rule.name}" {
  type              = "${rule.direction}"
  security_group_id = aws_security_group.vpc_default.id
  from_port         = ${rule.protocols[0]?.ports?.[0] || 0}
  to_port           = ${rule.protocols[0]?.ports?.[rule.protocols[0].ports.length - 1] || 65535}
  protocol          = "${rule.protocols[0]?.protocol || "tcp"}"
  cidr_blocks       = [${rule.ranges.map(r => `"${r}"`).join(", ")}]
  description       = "${rule.description || ""}"
}`;
        case "azure":
          return `
resource "azurerm_network_security_rule" "${rule.name}" {
  name                        = "${rule.name}"
  priority                    = ${rule.priority}
  direction                   = "${rule.direction}"
  access                      = "${rule.action}"
  protocol                    = "${rule.protocols[0]?.protocol === "all" ? "*" : rule.protocols[0]?.protocol || "Tcp"}"
  source_port_range           = "*"
  destination_port_range      = "${rule.protocols[0]?.ports?.join("-") || "*"}"
  source_address_prefixes     = [${rule.ranges.map(r => `"${r}"`).join(", ")}]
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.rg.name
  network_security_group_name = azurerm_network_security_group.vpc_nsg.name
  description                 = "${rule.description || ""}"
}`;
        default:
          return "";
      }
    });

    return rules?.join("\n") || "";
  }

  private generateDNSTF(): string {
    if (!this.config.dns) return "";

    switch (this.config.provider) {
      case "gcp":
        return `
# Private DNS Zone
resource "google_dns_managed_zone" "private" {
  name        = "${this.config.dns.zoneName.replace(/\./g, "-")}"
  dns_name    = "${this.config.dns.zoneName}."
  description = "Private DNS zone for Infinity project ${this.config.projectId}"
  visibility  = "private"
  private_visibility_config {
    networks = [google_compute_network.vpc.id]
  }
}

# DNS Peering
${this.config.dns.dnsPeering?.map(peering => `
resource "google_dns_peering" "${peering.name}" {
  name       = "${peering.name}"
  network    = google_compute_network.vpc.id
  target_project = "${peering.targetProjectId}"
  target_network = "${peering.targetNetwork}"
  target_zone = "${peering.targetZone}"
}
`).join("\n") || ""}`;
      case "aws":
        return `
# Private Hosted Zone
resource "aws_route53_zone" "private" {
  name = "${this.config.dns.zoneName}."
  vpc {
    vpc_id = aws_vpc.vpc.id
  }
}`;
      case "azure":
        return `
# Private DNS Zone
resource "azurerm_private_dns_zone" "private" {
  name                = "${this.config.dns.zoneName}"
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "private" {
  name                  = "vpc-link"
  resource_group_name   = azurerm_resource_group.rg.name
  private_dns_zone_name = azurerm_private_dns_zone.private.name
  virtual_network_name  = azurerm_virtual_network.vpc.name
  registration_enabled  = false
}`;
      default:
        return "";
    }
  }

  private generateFlowLogsTF(): string {
    if (!this.config.flowLogs?.enabled) return "";

    switch (this.config.provider) {
      case "gcp":
        return `
# VPC Flow Logs
resource "google_logging_folder_sink" "vpc_flow_logs" {
  name        = "infinity-${this.config.projectId}-${this.config.environment}-vpc-flow-logs"
  folder      = "folders/${this.config.projectId}"
  destination = "logging.googleapis.com/projects/${this.config.projectId}"
  filter      = "resource.type=gce_subnetwork AND logName:logs/compute.googleapis.com%2Fvpc_flows"
  unique_writer_identity = true
}`;
      case "aws":
        return `
# VPC Flow Logs
resource "aws_flow_log" "vpc_flow_logs" {
  log_destination      = "arn:aws:logs:${this.config.region}:${this.config.projectId}:log-group:infinity-vpc-flow-logs"
  traffic_type         = "${this.config.flowLogs.filter || "ALL"}"
  max_aggregation_interval = ${this.config.flowLogs.aggregationInterval === "interval_1_min" ? 60 : 600}
  destination_options {
    file_format = "parquet"
    hive_compatible_partitions = true
  }
}`;
      case "azure":
        return `
# NSG Flow Logs
resource "azurerm_network_watcher_flow_log" "vpc_flow_logs" {
  name                = "infinity-${this.config.projectId}-${this.config.environment}-flow-logs"
  location            = var.region
  resource_group_name = azurerm_resource_group.rg.name
  network_watcher_name = azurerm_network_watcher.main.name
  network_security_group_id = azurerm_network_security_group.vpc_nsg.id
  storage_account_id  = azurerm_storage_account.flowlogs.id
  enabled             = true
  retention_policy {
    enabled = true
    days    = 30
  }
}`;
      default:
        return "";
    }
  }

  private generateVariablesTF(): string {
    return `
variable "project_id" {
  description = "Project ID"
  type        = string
  default     = "${this.config.projectId}"
}

variable "region" {
  description = "Deployment region"
  type        = string
  default     = "${this.config.region}"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "${this.config.environment}"
}

variable "cidr_block" {
  description = "VPC CIDR block"
  type        = string
  default     = "${this.config.cidrBlock}"
}
`;
  }

  private generateOutputsTF(): string {
    switch (this.config.provider) {
      case "gcp":
        return `
output "vpc_id" {
  value = google_compute_network.vpc.id
}

output "vpc_name" {
  value = google_compute_network.vpc.name
}

output "subnets" {
  value = {
    ${this.config.subnets.map(s => `${s.name} = google_compute_subnetwork.${s.name}.id`).join("\n    ")}
  }
}

output "nat_ips" {
  value = google_compute_router_nat.nat[*].nat_ips
}

output "peering_connections" {
  value = {
    ${this.config.peerings?.map(p => `${p.name} = google_compute_network_peering.${p.name}.id`).join("\n    ") || ""}
  }
}`;
      case "aws":
        return `
output "vpc_id" {
  value = aws_vpc.vpc.id
}

output "vpc_name" {
  value = aws_vpc.vpc.tags["Name"]
}

output "subnets" {
  value = {
    ${this.config.subnets.map(s => `${s.name} = aws_subnet.${s.name}.id`).join("\n    ")}
  }
}

output "nat_ips" {
  value = aws_eip.nat[*].public_ip
}

output "peering_connections" {
  value = {
    ${this.config.peerings?.map(p => `${p.name} = aws_vpc_peering_connection.${p.name}.id`).join("\n    ") || ""}
  }
}`;
      case "azure":
        return `
output "vpc_id" {
  value = azurerm_virtual_network.vpc.id
}

output "vpc_name" {
  value = azurerm_virtual_network.vpc.name
}

output "subnets" {
  value = {
    ${this.config.subnets.map(s => `${s.name} = azurerm_subnet.${s.name}.id`).join("\n    ")}
  }
}

output "nat_ips" {
  value = azurerm_public_ip_prefix.nat.ip_prefix
}`;
      default:
        return "";
    }
  }
}

export interface TerraformOutput {
  provider: string;
  region: string;
  projectId: string;
  files: Record<string, string>;
}

/**
 * VPC Manager — handles VPC lifecycle operations
 */
export class VPCManager {
  private configs: Map<string, VPCConfig> = new Map();

  /** Register a VPC configuration */
  register(config: VPCConfig): void {
    const key = `${config.projectId}-${config.environment}`;
    this.configs.set(key, config);
    logger.info({ projectId: config.projectId, environment: config.environment }, "VPC config registered");
  }

  /** Get VPC configuration */
  get(projectId: string, environment: string): VPCConfig | undefined {
    return this.configs.get(`${projectId}-${environment}`);
  }

  /** Generate Terraform for a VPC */
  generateTerraform(projectId: string, environment: string): TerraformOutput | null {
    const config = this.get(projectId, environment);
    if (!config) return null;

    const generator = new VPCModuleGenerator(config);
    return generator.generateTerraform();
  }

  /** Generate Terraform for all registered VPCs */
  generateAllTerraform(): TerraformOutput[] {
    const outputs: TerraformOutput[] = [];
    for (const config of this.configs.values()) {
      const generator = new VPCModuleGenerator(config);
      outputs.push(generator.generateTerraform());
    }
    return outputs;
  }

  /** Get default VPC config for a project */
  getDefaultForProject(projectId: string): VPCConfig | undefined {
    // Return production VPC if exists, otherwise first one
    const prod = this.get(projectId, "prod") || this.get(projectId, "production");
    if (prod) return prod;

    for (const config of this.configs.values()) {
      if (config.projectId === projectId) return config;
    }
    return undefined;
  }
}

/**
 * Default VPC configurations for common setups
 */
export const defaultVPCConfigs: Record<string, Partial<VPCConfig>> = {
  "gcp-standard": {
    provider: "gcp",
    cidrBlock: "10.0.0.0/16",
    staticOutboundIPs: 2,
    subnets: [
      { name: "public", cidrBlock: "10.0.1.0/24", purpose: "public", privateAccess: false, natGateway: true },
      { name: "private", cidrBlock: "10.0.2.0/24", purpose: "private", privateAccess: true },
      { name: "database", cidrBlock: "10.0.3.0/24", purpose: "database", privateAccess: true },
      { name: "cache", cidrBlock: "10.0.4.0/24", purpose: "cache", privateAccess: true },
    ],
    firewallRules: [
      {
        name: "allow-http-https",
        direction: "ingress",
        action: "allow",
        priority: 1000,
        ranges: ["0.0.0.0/0"],
        protocols: [{ protocol: "tcp", ports: ["80", "443"] }],
        targets: ["http-server", "https-server"],
        description: "Allow HTTP/HTTPS from internet",
      },
      {
        name: "allow-internal",
        direction: "ingress",
        action: "allow",
        priority: 100,
        ranges: ["10.0.0.0/16"],
        protocols: [{ protocol: "all" }],
        description: "Allow all internal traffic",
      },
      {
        name: "deny-all-egress",
        direction: "egress",
        action: "deny",
        priority: 65534,
        ranges: ["0.0.0.0/0"],
        protocols: [{ protocol: "all" }],
        description: "Deny all egress by default (NAT handles allowed)",
      },
    ],
    flowLogs: {
      enabled: true,
      samplingRate: 0.5,
      filter: "all",
      destination: "logging",
      destinationConfig: {},
    },
  },
  "aws-standard": {
    provider: "aws",
    cidrBlock: "10.0.0.0/16",
    staticOutboundIPs: 2,
    subnets: [
      { name: "public-1", cidrBlock: "10.0.1.0/24", zone: "a", purpose: "public", natGateway: true },
      { name: "public-2", cidrBlock: "10.0.2.0/24", zone: "b", purpose: "public", natGateway: true },
      { name: "private-1", cidrBlock: "10.0.11.0/24", zone: "a", purpose: "private" },
      { name: "private-2", cidrBlock: "10.0.12.0/24", zone: "b", purpose: "private" },
      { name: "database-1", cidrBlock: "10.0.21.0/24", zone: "a", purpose: "database" },
      { name: "database-2", cidrBlock: "10.0.22.0/24", zone: "b", purpose: "database" },
    ],
  },
};

/**
 * Create a standard VPC config for a project
 */
export function createStandardVPCConfig(
  projectId: string,
  environment: string,
  provider: "gcp" | "aws" = "gcp",
  region: string = "us-central1"
): VPCConfig {
  const defaults = defaultVPCConfigs[`${provider}-standard`] || defaultVPCConfigs["gcp-standard"];

  return {
    projectId,
    environment,
    provider,
    region,
    ...defaults,
  } as VPCConfig;
}

/**
 * Default VPC manager instance
 */
export const vpcManager = new VPCManager();