using Docstore.Application.Interfaces;
using Docstore.Persistence.Contexts;
using Docstore.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Docstore.Persistence
{
    public static class ServiceRegistration
    {
        public static void AddPersistenceInfrastructure(this IServiceCollection services, IConfiguration configuration)
        {
            // database
            services.AddDbContext<AppDbContext>(options => options.UseNpgsql(configuration.GetConnectionString("DefaultConnection")));

            #region repositories
            services.AddTransient(typeof(IGenericRepository<>), typeof(GenericRepository<>));
            services.AddTransient<IDocumentRepository, DocumentRepository>();
            services.AddTransient<IFolderRepository, FolderRepository>();
            services.AddTransient<IDocumentFileRepository, DocumentFileRepository>();
            #endregion
        }
    }
}
