using Docstore.App.Data;
using Docstore.App.Models;
using Microsoft.EntityFrameworkCore;

namespace Docstore.App.Common
{
    public class AppDbContext : DbContext
    {
        public DbSet<Document> Documents
            => Set<Document>();

        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
        {
            ChangeTracker.QueryTrackingBehavior = QueryTrackingBehavior.NoTracking;
        }
    }
}
