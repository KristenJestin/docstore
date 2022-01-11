using Docstore.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace Docstore.Persistence.Contexts
{
    public class AppDbContext : DbContext
    {
        public DbSet<Document> Documents => Set<Document>();
        public DbSet<DocumentFile> DocumentFiles => Set<DocumentFile>();
        public DbSet<DocumentTag> DocumentTags => Set<DocumentTag>();
        public DbSet<Folder> Folders => Set<Folder>();

        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }


        #region overrides
        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            foreach (var entry in ChangeTracker.Entries<DatedBaseEntity>().Where(e => e.State == EntityState.Added || e.State == EntityState.Modified))
            {
                // on create
                if (entry.State.Equals(EntityState.Added))
                {
                    entry.Entity.CreatedAt = DateTime.UtcNow;
                    entry.Entity.UpdatedAt = DateTime.UtcNow;
                    //entry.Entity.CreatedBy = _authenticatedUser.UserId;
                }
                // on update
                else if (entry.State.Equals(EntityState.Modified))
                {
                    entry.Entity.UpdatedAt = DateTime.UtcNow;
                    //entry.Entity.UpdatedBy = _authenticatedUser.UserId;
                }
            }

            return base.SaveChangesAsync(cancellationToken);
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            // configures one-to-many relationship
            modelBuilder.Entity<DocumentFile>()
                .HasOne(e => e.Document)
                .WithMany(c => c.Files);

            modelBuilder.Entity<Document>()
                .HasOne(e => e.Folder)
                .WithMany(c => c.Documents);
        }
        #endregion
    }
}
