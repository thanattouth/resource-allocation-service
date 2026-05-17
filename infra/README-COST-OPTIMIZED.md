# Cost-Optimized Infrastructure (No RDS)

This setup replaces **RDS PostgreSQL** with **local PostgreSQL on EC2** to minimize AWS costs.

## Cost Comparison (US-East-1, monthly)

| Component | With RDS | Cost-Optimized | Savings |
|-----------|----------|----------------|---------|
| EC2 t3.micro | $8.50 | $8.50 | - |
| RDS db.t3.micro | $13.00 | $0 | **$13.00** |
| RDS Storage 20GB | $2.30 | $0 | **$2.30** |
| EBS gp3 30GB | - | $2.40 | -$2.40 |
| **Total** | **~$24** | **~$11** | **~$13** |

## What's Different?

### 1. PostgreSQL runs in Docker on EC2
- PostGIS extension included
- Data persisted on EBS volume
- Schema and seed data are initialized by the app image with `npm run init-db`

### 2. Same Application Code
- No code changes needed
- Same API, same behavior
- Environment variables point to local PostgreSQL and use the same auth/idempotency names as the main app

### 3. Removed RDS Dependencies
- No `existing_rds_*` variables needed
- No RDS security group rules
- No external database endpoint

## Migration Steps

### Option A: Fresh Deploy (Recommended)

1. **Backup data** from existing RDS (if needed):
   ```bash
   pg_dump -h your-rds-endpoint -U postgres disaster_db > backup.sql
   ```

2. **Update terraform.tfvars**:
   ```hcl
   # Remove these lines:
   # existing_rds_host = "..."
   # existing_rds_port = 5432
   # existing_rds_name = "..."
   # existing_rds_username = "..."
   # existing_rds_password = "..."
   # existing_rds_security_group_id = "..."
   ```

3. **Use cost-optimized main.tf**:
   ```bash
   cd infra
   # Backup original
   cp main.tf main.tf.with-rds
   # Use cost-optimized version
   cp cost-optimized.tf.disabled main.tf
   ```

4. **Deploy**:
   ```bash
   tofu init
   tofu plan
   tofu apply
   ```

5. **Restore data** (if backed up):
   ```bash
   # After EC2 is running
   scp backup.sql ec2-user@<ec2-ip>:/tmp/
   ssh ec2-user@<ec2-ip>
   docker exec -i resource-allocation-db psql -U postgres -d disaster_db < /tmp/backup.sql
   ```

### Option B: Manual Setup on Existing EC2

If you already have an EC2 running:

```bash
# SSH to EC2
ssh ec2-user@<your-ec2-ip>

# Run setup script
bash /opt/resource-allocation/setup-ec2-postgres.sh

# Or manually:
# 1. Install Docker and Docker Compose
# 2. Create docker-compose.yml
# 3. Start PostgreSQL
# 4. Start application
```

## Management Commands

```bash
# View logs
ssh ec2-user@<ip> 'docker-compose -C /opt/resource-allocation logs -f'

# Stop to save costs (data preserved)
ssh ec2-user@<ip> 'docker-compose -C /opt/resource-allocation stop'

# Start again
ssh ec2-user@<ip> 'docker-compose -C /opt/resource-allocation start'

# Database backup
ssh ec2-user@<ip> 'docker exec resource-allocation-db pg_dump -U postgres disaster_db > /var/lib/postgres-data/backup.sql'

# Check PostgreSQL status
ssh ec2-user@<ip> 'docker-compose -C /opt/resource-allocation ps'
```

## Data Persistence

PostgreSQL data is stored on:
- **Separate EBS volume** (`/dev/sdf` mounted at `/var/lib/postgres-data`)
- Survives container restarts
- Survives EC2 stops/starts
- **Note**: Terminating EC2 will delete data unless volume is preserved

## Security Considerations

1. **PostgreSQL not exposed externally**: Only accessible from containers on same host
2. **Password in user-data**: Change default password in production
3. **No SSL required**: Local communication only
4. **EBS encrypted**: Default enabled

## When to Use RDS Instead?

Consider switching back to RDS if:
- Need Multi-AZ high availability
- Need automated backups with point-in-time recovery
- Database grows > 100GB
- Need read replicas
- Multiple EC2 instances need to access same database

## Troubleshooting

### PostgreSQL won't start
```bash
ssh ec2-user@<ip>
sudo docker-compose -f /opt/resource-allocation/docker-compose.yml logs postgres
```

### Out of disk space
```bash
# Check disk usage
ssh ec2-user@<ip> 'df -h'

# Resize EBS volume in AWS Console, then:
sudo growpart /dev/nvme1n1 1
sudo resize2fs /dev/nvme1n1p1
```

### Data loss after restart
Check if EBS volume is properly mounted:
```bash
ssh ec2-user@<ip> 'mount | grep postgres'
```
